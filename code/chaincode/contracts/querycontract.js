'use strict';

const { Contract } = require('fabric-contract-api');
const PharmanetHelper = require('../utils/utils.js');
const DrugHelper = require('../utils/drugutils.js');

class QueryContract extends Contract {

	constructor() {
		super('org.pharma-network.pharmanet.querycontract');
	}

	static normalizeOptional(value) {
		if (value === undefined || value === null) {
			return '';
		}
		return String(value).trim();
	}

	static incrementCounter(counter, key) {
		counter[key] = (counter[key] || 0) + 1;
	}

	static THRESHOLD_MFG_DIST_BATCH_DAYS = 90;
	static THRESHOLD_DISTRIBUTOR_HOARDING_DAYS = 60;
	static THRESHOLD_RETAILER_STAGNANCY_DAYS = 540;
	static INVENTORY_STATUSES = ['PRODUCED', 'IN_STORES', 'AVAILABLE'];

	static isMfgDistBatchDwell(organisationRole, pouch, inInventory, dwellDays) {
		if (!inInventory || dwellDays === null) {
			return false;
		}
		if (dwellDays < QueryContract.THRESHOLD_MFG_DIST_BATCH_DAYS) {
			return false;
		}
		if (organisationRole === 'Manufacturer' && pouch.status === 'PRODUCED') {
			return true;
		}
		if (organisationRole === 'Distributor' && pouch.status === 'IN_STORES') {
			return true;
		}
		return false;
	}

	static isDistributorHoarding(organisationRole, pouch, dwellDays) {
		return organisationRole === 'Distributor'
			&& pouch.status === 'IN_STORES'
			&& dwellDays !== null
			&& dwellDays >= QueryContract.THRESHOLD_DISTRIBUTOR_HOARDING_DAYS;
	}

	static isRetailerStagnancy(organisationRole, pouch, dwellDays) {
		return organisationRole === 'Retailer'
			&& pouch.status === 'AVAILABLE'
			&& dwellDays !== null
			&& dwellDays >= QueryContract.THRESHOLD_RETAILER_STAGNANCY_DAYS;
	}

	static parseLedgerDate(value) {
		if (!value) {
			return null;
		}
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	static daysBetween(fromDate, toDate) {
		const msPerDay = 1000 * 60 * 60 * 24;
		return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay);
	}

	static getLocationEntryDate(pouch) {
		return QueryContract.parseLedgerDate(
			pouch.locationEnteredAt || pouch.updatedAt || pouch.manufactureDate
		);
	}

	static isCalendarExpired(pouch, evaluatedAt) {
		if (!pouch || pouch.status === 'DISPENSED') {
			return false;
		}
		const expiry = QueryContract.parseLedgerDate(pouch.expiryDate);
		return expiry ? expiry < evaluatedAt : false;
	}

	static createEmptyCompanyBucket(company) {
		return {
			companyKey: company.key,
			companyCRN: company.companyCRN,
			companyName: company.companyName,
			organisationRole: company.data.organisationRole || null,
			location: company.data.location || null,
			calendarExpiry: {
				totalUnits: 0,
				totalBatches: 0,
				batches: {}
			},
			dwellOver3MonthsBatch: {
				totalBatches: 0,
				totalUnits: 0,
				byGtin: {}
			},
			distributorHoardingOver2Months: {
				totalUnits: 0,
				totalBatches: 0,
				batches: {}
			},
			retailerStagnancyOver18Months: {
				totalUnits: 0,
				totalBatches: 0,
				batches: {}
			}
		};
	}

	static upsertBatchBucket(batchMap, gtin, batchNo, drugName) {
		const batchKey = `${gtin}::${batchNo}`;
		if (!batchMap[batchKey]) {
			batchMap[batchKey] = {
				gtin,
				batchNo,
				drugName: drugName || null,
				unitCount: 0,
				units: []
			};
		}
		if (!batchMap[batchKey].drugName && drugName) {
			batchMap[batchKey].drugName = drugName;
		}
		return batchMap[batchKey];
	}

	static finalizeBatchList(batchMap) {
		return Object.values(batchMap).map((batch) => ({
			gtin: batch.gtin,
			batchNo: batch.batchNo,
			drugName: batch.drugName,
			unitCount: batch.unitCount,
			units: batch.units
		}));
	}

	static finalizeGtinBatchCounts(byGtinMap) {
		return Object.values(byGtinMap).map((entry) => ({
			gtin: entry.gtin,
			drugName: entry.drugName,
			batchCount: entry.batchNumbers.size,
			totalUnits: entry.totalUnits,
			batchNumbers: Array.from(entry.batchNumbers)
		}));
	}

	static buildUnitInsight(pouch, evaluatedAt, dwellDays, flags) {
		return {
			gtin: pouch.gtin || null,
			serialNumber: pouch.serialNumber || null,
			batchNo: pouch.batchNo || null,
			drugName: pouch.drugName || null,
			expiryDate: pouch.expiryDate
				? PharmanetHelper.formatDateValue(pouch.expiryDate)
				: null,
			status: pouch.status || 'UNKNOWN',
			locationEnteredAt: PharmanetHelper.normalizeDateValue(
				pouch.locationEnteredAt || pouch.updatedAt || pouch.manufactureDate
			),
			dwellDays,
			dwellMonths: dwellDays !== null ? Number((dwellDays / 30.437).toFixed(1)) : null,
			flags
		};
	}

	static async formatPurchaseOrder(ctx, poEntry) {
		const po = poEntry.data;
		const buyer = await PharmanetHelper.enrichCompanyReference(ctx, po.buyer);
		const seller = await PharmanetHelper.enrichCompanyReference(ctx, po.seller);

		return {
			poID: po.poID || poEntry.key,
			gtin: po.gtin,
			drugName: po.drugName,
			quantity: po.quantity,
			buyer: po.buyer,
			buyerCRN: buyer.companyCRN,
			buyerName: buyer.companyName,
			seller: po.seller,
			sellerCRN: seller.companyCRN,
			sellerName: seller.companyName,
			createdAt: PharmanetHelper.normalizeDateValue(po.createdAt),
			updatedAt: PharmanetHelper.normalizeDateValue(po.updatedAt)
		};
	}

	/**
	 * Query all purchase orders on the network.
	 * Optional sellerCRN filter for manufacturers.
	 */
	async queryAllPOs(ctx, sellerCRN) {
		const sellerFilter = QueryContract.normalizeOptional(sellerCRN);
		let sellerKey = null;

		if (sellerFilter) {
			sellerKey = await DrugHelper.getCompanyKey(ctx, sellerFilter, 'Seller');
		}

		const allPurchaseOrders = await PharmanetHelper.iteratePurchaseOrders(ctx);
		const filtered = sellerKey
			? allPurchaseOrders.filter((entry) => entry.data.seller === sellerKey)
			: allPurchaseOrders;

		const purchaseOrders = await Promise.all(
			filtered.map((entry) => QueryContract.formatPurchaseOrder(ctx, entry))
		);

		return {
			totalCount: purchaseOrders.length,
			filter: sellerFilter || null,
			purchaseOrders
		};
	}

	/**
	 * Query all registered companies on the network.
	 */
	async queryAllCompanies(ctx) {
		const entries = await PharmanetHelper.iterateCompanies(ctx);
		const companies = [];
		const roleBreakdown = {};

		for (const entry of entries) {
			const parts = PharmanetHelper.parseCompositeKeyParts(ctx.stub, entry.key);
			const companyCRN = parts[0] || null;
			const companyName = entry.data.name || parts[1] || null;
			const organisationRole = entry.data.organisationRole || 'UNKNOWN';

			companies.push({
				companyKey: entry.key,
				companyCRN,
				companyName,
				location: entry.data.location || null,
				organisationRole,
				licenseNumber: entry.data.licenseNumber || null,
				status: entry.data.status || 'ACTIVE',
				registeredAt: PharmanetHelper.normalizeDateValue(entry.data.registeredAt)
			});

			QueryContract.incrementCounter(roleBreakdown, organisationRole);
		}

		return {
			totalCompanies: companies.length,
			roleBreakdown,
			companies
		};
	}

	/**
	 * Query all medicine pouches by GTIN and optional batch number.
	 */
	async queryDrugUnits(ctx, gtin, batchNo) {
		const gtinValue = QueryContract.normalizeOptional(gtin);
		if (!gtinValue) {
			throw new Error('GTIN is required.');
		}

		await DrugHelper.verifyGtin(ctx, gtinValue);
		const batchFilter = QueryContract.normalizeOptional(batchNo);

		const pouches = await PharmanetHelper.iteratePouches(ctx, gtinValue);
		const filtered = batchFilter
			? pouches.filter((pouch) => pouch.batchNo === batchFilter)
			: pouches;

		const statusBreakdown = {};
		const batchBreakdown = {};
		let drugName = null;
		let totalValue = 0;

		const units = await Promise.all(filtered.map(async (pouch) => {
			const unit = await PharmanetHelper.buildDrugUnitView(ctx, pouch);

			totalValue += unit.price || 0;
			if (!drugName && unit.drugName) {
				drugName = unit.drugName;
			}

			QueryContract.incrementCounter(statusBreakdown, unit.status || 'UNKNOWN');
			if (unit.batchNo) {
				QueryContract.incrementCounter(batchBreakdown, unit.batchNo);
			}

			return unit;
		}));

		const totalUnits = units.length;

		return {
			gtin: gtinValue,
			drugName,
			batchNo: batchFilter || 'ALL',
			totalUnits,
			totalValue,
			averagePrice: totalUnits > 0 ? totalValue / totalUnits : 0,
			statusBreakdown,
			batchBreakdown,
			units
		};
	}

	/**
	 * Query status breakdown for medicine pouches by GTIN and optional batch.
	 */
	async queryDrugStatusBreakdown(ctx, gtin, batchNo) {
		const gtinValue = QueryContract.normalizeOptional(gtin);
		if (!gtinValue) {
			throw new Error('GTIN is required.');
		}

		await DrugHelper.verifyGtin(ctx, gtinValue);
		const batchFilter = QueryContract.normalizeOptional(batchNo);

		const pouches = await PharmanetHelper.iteratePouches(ctx, gtinValue);
		const filtered = batchFilter
			? pouches.filter((pouch) => pouch.batchNo === batchFilter)
			: pouches;

		const statusBreakdown = {};
		let drugName = null;
		let totalValue = 0;
		let totalUnits = 0;

		for (const pouch of filtered) {
			const status = pouch.status || 'UNKNOWN';
			const unitPrice = pouch.price !== undefined && pouch.price !== null ? Number(pouch.price) : 0;

			totalUnits += 1;
			totalValue += unitPrice;

			if (!drugName && pouch.drugName) {
				drugName = pouch.drugName;
			}

			if (!statusBreakdown[status]) {
				statusBreakdown[status] = {
					count: 0,
					totalValue: 0,
					serialNumbers: [],
					batchNumbers: []
				};
			}

			statusBreakdown[status].count += 1;
			statusBreakdown[status].totalValue += unitPrice;
			statusBreakdown[status].serialNumbers.push(pouch.serialNumber || null);

			if (pouch.batchNo && !statusBreakdown[status].batchNumbers.includes(pouch.batchNo)) {
				statusBreakdown[status].batchNumbers.push(pouch.batchNo);
			}
		}

		for (const status of Object.keys(statusBreakdown)) {
			const details = statusBreakdown[status];
			details.averagePrice = details.count > 0 ? details.totalValue / details.count : 0;
		}

		return {
			gtin: gtinValue,
			drugName,
			batchNo: batchFilter || 'ALL',
			totalUnits,
			totalValue,
			statusBreakdown
		};
	}

	/**
	 * Query medicine pouches currently associated with a company (CRN or name).
	 */
	async queryAllDrugsByCompanyCRN(ctx, companyIdentifier) {
		const company = await PharmanetHelper.findCompanyByIdentifier(ctx, companyIdentifier);
		const allPouches = await PharmanetHelper.iteratePouches(ctx);

		const companyDrugs = [];
		const statusBreakdown = {};
		const batchBreakdown = {};
		const gtinMap = new Map();
		let totalValue = 0;

		for (const pouch of allPouches) {
			if (!await PharmanetHelper.pouchBelongsToCompany(ctx, pouch, company)) {
				continue;
			}

			const drugInfo = await PharmanetHelper.buildDrugUnitView(ctx, pouch);
			companyDrugs.push(drugInfo);
			totalValue += drugInfo.price || 0;

			QueryContract.incrementCounter(statusBreakdown, drugInfo.status || 'UNKNOWN');
			if (drugInfo.batchNo) {
				QueryContract.incrementCounter(batchBreakdown, drugInfo.batchNo);
			}

			if (!gtinMap.has(drugInfo.gtin)) {
				gtinMap.set(drugInfo.gtin, {
					gtin: drugInfo.gtin,
					drugName: drugInfo.drugName,
					totalUnits: 0,
					totalValue: 0,
					batchNumbers: new Set()
				});
			}

			const gtinSummary = gtinMap.get(drugInfo.gtin);
			gtinSummary.totalUnits += 1;
			gtinSummary.totalValue += drugInfo.price || 0;
			if (drugInfo.batchNo) {
				gtinSummary.batchNumbers.add(drugInfo.batchNo);
			}
		}

		const gtinSummary = Array.from(gtinMap.values()).map((entry) => ({
			gtin: entry.gtin,
			drugName: entry.drugName,
			totalUnits: entry.totalUnits,
			totalValue: entry.totalValue,
			averagePrice: entry.totalUnits > 0 ? entry.totalValue / entry.totalUnits : 0,
			batchNumbers: Array.from(entry.batchNumbers)
		}));

		return {
			searchTerm: QueryContract.normalizeOptional(companyIdentifier),
			companyCRN: company.companyCRN,
			companyName: company.companyName,
			companyRole: company.data.organisationRole || null,
			totalDrugUnits: companyDrugs.length,
			totalValue,
			averagePrice: companyDrugs.length > 0 ? totalValue / companyDrugs.length : 0,
			uniqueGTINs: gtinSummary.length,
			gtinSummary,
			batchBreakdown,
			statusBreakdown,
			drugUnits: companyDrugs
		};
	}

	/**
	 * Compliance analytics: calendar expiry + location dwell (4 / 6 month thresholds).
	 * Deterministic rule-based query — no ML required.
	 *
	 * @param companyCRN - optional company filter (CRN or name)
	 * @param gtin - optional GTIN filter
	 * @param batchNo - optional batch filter
	 */
	async queryExpiryAndStagnancyAnalytics(ctx, companyCRN, gtin, batchNo) {
		const evaluatedAt = PharmanetHelper.getTxTimestamp(ctx);
		const companyFilter = QueryContract.normalizeOptional(companyCRN);
		const gtinFilter = QueryContract.normalizeOptional(gtin);
		const batchFilter = QueryContract.normalizeOptional(batchNo);

		let scopedCompany = null;
		if (companyFilter) {
			scopedCompany = await PharmanetHelper.findCompanyByIdentifier(ctx, companyFilter);
		}

		const companyEntries = await PharmanetHelper.iterateCompanies(ctx);
		const companyByKey = new Map();
		for (const entry of companyEntries) {
			const parts = PharmanetHelper.parseCompositeKeyParts(ctx.stub, entry.key);
			companyByKey.set(entry.key, {
				key: entry.key,
				data: entry.data,
				companyCRN: parts[0] || null,
				companyName: entry.data.name || parts[1] || null
			});
		}

		const pouches = await PharmanetHelper.iteratePouches(ctx, gtinFilter || null);
		const companyBuckets = new Map();
		const globalSummary = {
			totalUnitsScanned: 0,
			calendarExpiredUnits: 0,
			calendarExpiredBatches: new Set(),
			dwellOver3MonthUnits: 0,
			dwellOver3MonthBatches: new Set(),
			distributorHoarding2MonthUnits: 0,
			distributorHoarding2MonthBatches: new Set(),
			retailerStagnancy18MonthUnits: 0,
			retailerStagnancy18MonthBatches: new Set()
		};

		for (const pouch of pouches) {
			if (batchFilter && pouch.batchNo !== batchFilter) {
				continue;
			}
			if (!pouch.ownerCompanyKey || !companyByKey.has(pouch.ownerCompanyKey)) {
				continue;
			}

			const company = companyByKey.get(pouch.ownerCompanyKey);
			if (scopedCompany && company.key !== scopedCompany.key) {
				continue;
			}

			if (!companyBuckets.has(company.key)) {
				companyBuckets.set(company.key, QueryContract.createEmptyCompanyBucket(company));
			}
			const bucket = companyBuckets.get(company.key);

			globalSummary.totalUnitsScanned += 1;

			const organisationRole = company.data.organisationRole || null;
			const entryDate = QueryContract.getLocationEntryDate(pouch);
			const dwellDays = entryDate ? QueryContract.daysBetween(entryDate, evaluatedAt) : null;
			const inInventory = QueryContract.INVENTORY_STATUSES.includes(pouch.status);
			const calendarExpired = QueryContract.isCalendarExpired(pouch, evaluatedAt);
			const mfgDistBatchDwell = QueryContract.isMfgDistBatchDwell(
				organisationRole,
				pouch,
				inInventory,
				dwellDays
			);
			const distributorHoarding = QueryContract.isDistributorHoarding(
				organisationRole,
				pouch,
				dwellDays
			);
			const retailerStagnancy = QueryContract.isRetailerStagnancy(
				organisationRole,
				pouch,
				dwellDays
			);

			const flags = {
				calendarExpired,
				batchOver3Months: mfgDistBatchDwell,
				distributorHoardingOver2Months: distributorHoarding,
				retailerStagnancyOver18Months: retailerStagnancy
			};
			const unitInsight = QueryContract.buildUnitInsight(
				pouch,
				evaluatedAt,
				dwellDays,
				flags
			);

			if (calendarExpired) {
				globalSummary.calendarExpiredUnits += 1;
				if (pouch.batchNo) {
					globalSummary.calendarExpiredBatches.add(`${pouch.gtin}::${pouch.batchNo}`);
				}
				bucket.calendarExpiry.totalUnits += 1;
				const batchBucket = QueryContract.upsertBatchBucket(
					bucket.calendarExpiry.batches,
					pouch.gtin,
					pouch.batchNo,
					pouch.drugName
				);
				batchBucket.unitCount += 1;
				batchBucket.units.push(unitInsight);
			}

			if (mfgDistBatchDwell) {
				globalSummary.dwellOver3MonthUnits += 1;
				if (pouch.batchNo) {
					globalSummary.dwellOver3MonthBatches.add(`${pouch.gtin}::${pouch.batchNo}`);
				}
				bucket.dwellOver3MonthsBatch.totalUnits += 1;
				if (!bucket.dwellOver3MonthsBatch.byGtin[pouch.gtin]) {
					bucket.dwellOver3MonthsBatch.byGtin[pouch.gtin] = {
						gtin: pouch.gtin,
						drugName: pouch.drugName || null,
						batchNumbers: new Set(),
						totalUnits: 0
					};
				}
				const gtinBucket = bucket.dwellOver3MonthsBatch.byGtin[pouch.gtin];
				gtinBucket.totalUnits += 1;
				if (pouch.batchNo) {
					gtinBucket.batchNumbers.add(pouch.batchNo);
				}
				if (!gtinBucket.drugName && pouch.drugName) {
					gtinBucket.drugName = pouch.drugName;
				}
			}

			if (distributorHoarding) {
				globalSummary.distributorHoarding2MonthUnits += 1;
				if (pouch.batchNo) {
					globalSummary.distributorHoarding2MonthBatches.add(`${pouch.gtin}::${pouch.batchNo}`);
				}
				bucket.distributorHoardingOver2Months.totalUnits += 1;
				const hoardingBatch = QueryContract.upsertBatchBucket(
					bucket.distributorHoardingOver2Months.batches,
					pouch.gtin,
					pouch.batchNo,
					pouch.drugName
				);
				hoardingBatch.unitCount += 1;
				hoardingBatch.units.push(unitInsight);
			}

			if (retailerStagnancy) {
				globalSummary.retailerStagnancy18MonthUnits += 1;
				if (pouch.batchNo) {
					globalSummary.retailerStagnancy18MonthBatches.add(`${pouch.gtin}::${pouch.batchNo}`);
				}
				bucket.retailerStagnancyOver18Months.totalUnits += 1;
				const retailerBatch = QueryContract.upsertBatchBucket(
					bucket.retailerStagnancyOver18Months.batches,
					pouch.gtin,
					pouch.batchNo,
					pouch.drugName
				);
				retailerBatch.unitCount += 1;
				retailerBatch.units.push(unitInsight);
			}
		}

		const companies = Array.from(companyBuckets.values())
			.map((bucket) => {
			const calendarBatches = QueryContract.finalizeBatchList(bucket.calendarExpiry.batches);
			const hoardingBatches = QueryContract.finalizeBatchList(
				bucket.distributorHoardingOver2Months.batches
			);
			const retailerBatches = QueryContract.finalizeBatchList(
				bucket.retailerStagnancyOver18Months.batches
			);
			const dwellGtinSummary = QueryContract.finalizeGtinBatchCounts(
				bucket.dwellOver3MonthsBatch.byGtin
			);

			bucket.calendarExpiry.batches = calendarBatches;
			bucket.calendarExpiry.totalBatches = calendarBatches.length;
			bucket.dwellOver3MonthsBatch.byGtin = dwellGtinSummary;
			bucket.dwellOver3MonthsBatch.totalBatches = dwellGtinSummary.reduce(
				(sum, entry) => sum + entry.batchCount,
				0
			);
			bucket.distributorHoardingOver2Months.batches = hoardingBatches;
			bucket.distributorHoardingOver2Months.totalBatches = hoardingBatches.length;
			bucket.retailerStagnancyOver18Months.batches = retailerBatches;
			bucket.retailerStagnancyOver18Months.totalBatches = retailerBatches.length;

			return bucket;
		})
			.filter((bucket) => (
				bucket.calendarExpiry.totalUnits > 0
				|| bucket.dwellOver3MonthsBatch.totalUnits > 0
				|| bucket.distributorHoardingOver2Months.totalUnits > 0
				|| bucket.retailerStagnancyOver18Months.totalUnits > 0
			));

		return {
			evaluatedAt: evaluatedAt.toISOString(),
			methodology: {
				approach: 'deterministic-threshold-query',
				mlRequired: false,
				description: 'Role-specific dwell thresholds for manufacturer, distributor, and retailer.',
				calendarExpiryRule: 'expiryDate < evaluatedAt AND status != DISPENSED',
				locationDwellRule: 'dwellDays = evaluatedAt - (locationEnteredAt || updatedAt || manufactureDate)',
				mfgDistBatchDwellRule: 'Manufacturer PRODUCED OR Distributor IN_STORES AND dwellDays >= 90',
				distributorHoardingRule: 'Distributor IN_STORES AND dwellDays >= 60',
				retailerStagnancyRule: 'Retailer AVAILABLE AND dwellDays >= 540',
				thresholds: {
					mfgDistBatchDays: QueryContract.THRESHOLD_MFG_DIST_BATCH_DAYS,
					mfgDistBatchMonths: 3,
					distributorHoardingDays: QueryContract.THRESHOLD_DISTRIBUTOR_HOARDING_DAYS,
					distributorHoardingMonths: 2,
					retailerStagnancyDays: QueryContract.THRESHOLD_RETAILER_STAGNANCY_DAYS,
					retailerStagnancyMonths: 18
				}
			},
			filters: {
				companyCRN: companyFilter || null,
				gtin: gtinFilter || null,
				batchNo: batchFilter || null
			},
			globalSummary: {
				totalUnitsScanned: globalSummary.totalUnitsScanned,
				calendarExpiredUnits: globalSummary.calendarExpiredUnits,
				calendarExpiredBatches: globalSummary.calendarExpiredBatches.size,
				dwellOver3MonthUnits: globalSummary.dwellOver3MonthUnits,
				dwellOver3MonthBatches: globalSummary.dwellOver3MonthBatches.size,
				distributorHoarding2MonthUnits: globalSummary.distributorHoarding2MonthUnits,
				distributorHoarding2MonthBatches: globalSummary.distributorHoarding2MonthBatches.size,
				retailerStagnancy18MonthUnits: globalSummary.retailerStagnancy18MonthUnits,
				retailerStagnancy18MonthBatches: globalSummary.retailerStagnancy18MonthBatches.size
			},
			companies
		};
	}

}

module.exports = QueryContract;
