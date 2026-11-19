'use strict';

//Get list of company roles in pharma network
const PHARMANETROLES = require('../enums/pharmarolesenum.js');
const PHARMANETORGS = require('../enums/pharmaorgsenum.js');
const PHARMANETASSETS = require('../enums/pharmaassetsenum.js');

//Namespaces used for pharma assets
const pharmaPrefix = 'org.pharma-network.pharmanet.'; //Common preifx for all namespaces
const pharmaNamespaces = 
	{
		Company: pharmaPrefix + 'company',
		Drug: pharmaPrefix + 'drug',
		PurchaseOrder: pharmaPrefix + 'purchaseorder',
		Shipment: pharmaPrefix + 'shipment'
	}
Object.freeze(pharmaNamespaces);

//This class contains all helper utility functions like fetching data from ledger, verifying data existence...
class PharmanetHelper {

	/**
	 * Deterministic transaction time (identical on every endorsing peer).
	 * Use instead of new Date()/Date.now() inside any chaincode function that writes state.
	 */
	static getTxTimestamp(ctx) {
		const ts = ctx.stub.getTxTimestamp();
		let seconds = ts.seconds;
		if (seconds && typeof seconds.toNumber === 'function') {
			seconds = seconds.toNumber();
		} else if (seconds && typeof seconds === 'object') {
			seconds = seconds.low || 0;
		}
		return new Date((Number(seconds) || 0) * 1000 + Math.floor((ts.nanos || 0) / 1000000));
	}

	static getTxTimestampISO(ctx) {
		return PharmanetHelper.getTxTimestamp(ctx).toISOString();
	}

	/**
	 * Helper function to get organization of  requestor
	 * @param ctx - The transaction context object
	 * @returns
	 */
	static getRequestorOrg(ctx) {
		//Return requestor MSP value
		return ctx.clientIdentity.getMSPID();
	}

  	/**
	 * Helper function to get asset data buffer from ledger
	 * @param ctx - The transaction context object
	 * @param assetKey - Composite key of asset to be fetched
	 * @returns
	 */
	static async getAssetBuffer(ctx, assetKey) {
		//Fetch asset details with given key
		return ctx.stub
				.getState(assetKey)
				.catch(err => console.log(err));
	}

	/**
	 * Helper function to put asset data on ledger
	 * @param ctx - The transaction context object
	 * @param assetKey - Composite key of asset to be created or updated
	 * @param assetData - Asset data to put on ledger
	 * @returns
	 */
	static async putAssetData(ctx, assetKey, assetData) {
		//Convert input JSON object to buffer and store it to blockchain
		let dataBuffer = Buffer.from(JSON.stringify(assetData));
		await ctx.stub.putState(assetKey, dataBuffer);
	}

  	/**
	 * Helper function to get asset iterator from ledger based on given partial composite key prefix
	 * @param ctx - The transaction context object
	 * @param assetNamespace - Namespace of the asset to be fetched
	 * @param partialAssetKey - Partial composite key prefix of asset to be fetched
	 * @returns
	 */
	static async getAssetIterator(ctx, assetNamespace, partialAssetKey) {
		//Return asset iterator for given partial key
		return ctx.stub
				.getStateByPartialCompositeKey(assetNamespace,[partialAssetKey])
				.catch(err => console.log(err));
	}

  	/**
	 * Helper function to get history of an asset from ledger
	 * @param ctx - The transaction context object
	 * @param assetKey - Composite key of asset whose history is to be fetched
	 * @returns
	 */
	static async getAssetHistory(ctx, assetKey) {
		//Return iterator of asset history for the key provided
		return await ctx.stub.getHistoryForKey(assetKey);
	}	

  	/**
	 * Helper function to verify if given asset exists
	 * @param ctx - The transaction context object
	 * @param assetKey - Composite key of asset to be verified
	 * @returns
	 */
	static async isAssetExisting(ctx, assetKey) {
		//Return true if asset is existing
		let assetBuffer = await PharmanetHelper.getAssetBuffer(ctx, assetKey);
		return assetBuffer.length !== 0;
	}

  	/**
	 * Helper function to get first asset from the list of assets starting with a partial key
	 * @param ctx - The transaction context object
	 * @param assetType - Type of asset to be fetched
	 * @param assetKeyPrefix - Partial composite key prefix of asset to be fetched
	 * @returns
	 */
	static async getFirstAssetFromKeyPrefix(ctx, assetType, assetKeyPrefix) {
		//Get iterator of assets based on asset type partial composite key provided
		let assetIterator = await PharmanetHelper.getAssetIterator(ctx,pharmaNamespaces[assetType],assetKeyPrefix);
		let asset = await assetIterator.next();

		//If there are no assets for given key then iterator will have no results
		//Thus accessing next() result from iterator will give only done status
		//If next() returns value then at least one asset is existing with given partial key prefix
		let assetValue = asset.value;
		
		//Close the iterator if matching assets are existing, if not then iterator is already closed by this point
		if(assetValue){
			await assetIterator.close();
		}

		return assetValue;
	}

  	/**
	 * Helper function to get asset data from ledger
	 * @param ctx - The transaction context object
	 * @param assetKey - Composite key of asset to be fetched
	 * @returns
	 */
	static async getAssetData(ctx, assetKey) {
		let assetData = await PharmanetHelper.getAssetBuffer(ctx, assetKey);

		//Return asset JSON object if asset is existing
		if(assetData.length !== 0){
			return JSON.parse(assetData.toString());
		}
	}

  	/**
	 * Helper function to get role for given company key
	 * @param ctx - The transaction context object
	 * @param companyKey - Composite key of the company to fech role
	 * @returns
	 */
	static async getCompanyRole(ctx, companyKey) {
		let companyBuffer = await PharmanetHelper.getAssetBuffer(ctx, companyKey);
		let companyJSON = JSON.parse(companyBuffer.toString());
		return PHARMANETROLES[companyJSON.organisationRole];
	}

	static async iterateCompanies(ctx) {
		const iterator = await ctx.stub.getStateByPartialCompositeKey(pharmaNamespaces.Company, []);
		const companies = [];

		while (true) {
			const result = await iterator.next();
			if (result.value) {
				companies.push({
					key: result.value.key,
					data: JSON.parse(result.value.value.toString('utf8'))
				});
			}
			if (result.done) {
				await iterator.close();
				break;
			}
		}

		return companies;
	}

	static getFabricMspForRole(organisationRole) {
		const map = {
			Manufacturer: 'manufacturerMSP',
			Distributor: 'distributorMSP',
			Retailer: 'retailerMSP',
			Transporter: 'transporterMSP'
		};
		return map[organisationRole] || null;
	}

	static async resolveCompanyNameByKey(ctx, companyKey) {
		if (!companyKey) {
			return null;
		}
		const company = await PharmanetHelper.getAssetData(ctx, companyKey);
		return company && company.name ? company.name : null;
	}

	static async resolveCompanyNameByMsp(ctx, mspId) {
		if (!mspId || !mspId.includes('MSP')) {
			return null;
		}

		const companies = await PharmanetHelper.iterateCompanies(ctx);
		for (const entry of companies) {
			if (PharmanetHelper.getFabricMspForRole(entry.data.organisationRole) === mspId) {
				return entry.data.name;
			}
		}

		return null;
	}

	static async resolveCompanyMspByKey(ctx, companyKey) {
		if (!companyKey) {
			return null;
		}
		const company = await PharmanetHelper.getAssetData(ctx, companyKey);
		if (!company || !company.organisationRole) {
			return null;
		}
		return PharmanetHelper.getFabricMspForRole(company.organisationRole);
	}

	/**
	 * Verify caller MSP is Manufacturer and an ACTIVE manufacturer company exists on ledger
	 * @param ctx - Transaction context
	 * @param companyCRN - Optional manufacturer CRN for strict company-level validation
	 */
	static async validateActiveManufacturer(ctx, companyCRN) {
		const clientMSP = PharmanetHelper.getRequestorOrg(ctx);
		if (clientMSP !== PHARMANETORGS.MANUFACTURER) {
			throw new Error('Security Access Denied: Only authorized Manufacturers can add drugs to the supply chain.');
		}

		if (companyCRN) {
			const asset = await PharmanetHelper.getFirstAssetFromKeyPrefix(ctx, PHARMANETASSETS.Company, companyCRN);
			if (!asset) {
				throw new Error(`Access Denied: Manufacturer with CRN ${companyCRN} is not registered on pharma network.`);
			}

			const companyData = JSON.parse(asset.value.toString('utf8'));
			if (companyData.organisationRole !== 'Manufacturer') {
				throw new Error('Access Denied: Given company CRN is not a registered manufacturer.');
			}
			if (companyData.status !== 'ACTIVE') {
				throw new Error('Access Denied: Manufacturer status is not ACTIVE.');
			}

			return { key: asset.key, data: companyData };
		}

		const companies = await PharmanetHelper.iterateCompanies(ctx);
		const activeManufacturer = companies.find(
			company => company.data.organisationRole === 'Manufacturer' && company.data.status === 'ACTIVE'
		);

		if (!activeManufacturer) {
			throw new Error('Access Denied: No active manufacturer company is registered on the pharma network.');
		}

		return activeManufacturer;
	}

  	/**
	 * Helper function to construct Company composite key
	 * @param ctx - The transaction context object
	 * @param companyCRN - Company Registration Number
	 * @param companyName - Name of the company
	 * @returns
	 */
	static getCompanyKey(ctx, companyCRN, companyName) {
		return ctx.stub.createCompositeKey(pharmaNamespaces.Company, [companyCRN,companyName]);
	}

  	/**
	 * Helper function to construct Drug composite key
	 * @param ctx - The transaction context object
	 * @param drugName - Name of the drug
	 * @param serialNo - Serial number of the drug
	 * @returns
	 */
	static getDrugKey(ctx, drugName, serialNo) {
		return ctx.stub.createCompositeKey(pharmaNamespaces.Drug, [drugName,serialNo]);
	}

	static getPouchKey(gtin, serialNo) {
		return 'POUCH_' + gtin + '_' + serialNo;
	}

	static roleToOwnerMsp(role) {
		const map = {
			Manufacturer: 'ManufacturerOrgMSP',
			Distributor: 'DistributorOrgMSP',
			Retailer: 'RetailerOrgMSP',
			Transporter: 'TransporterOrgMSP'
		};
		return map[role] || role;
	}

	static statusFromOwnerMsp(ownerMsp) {
		const map = {
			ManufacturerOrgMSP: 'PRODUCED',
			TransporterOrgMSP: 'IN_TRANSIT',
			DistributorOrgMSP: 'IN_STORES',
			RetailerOrgMSP: 'AVAILABLE',
			ConsumerOrgMSP: 'DISPENSED'
		};
		return map[ownerMsp] || 'PRODUCED';
	}

	static formatDateValue(value) {
		if (!value) return value;
		const d = value instanceof Date ? value : new Date(value);
		if (isNaN(d.getTime())) return value;
		return d.toISOString().split('T')[0];
	}

	static async resolveOwnerMsp(ctx, ownerKey) {
		if (!ownerKey) return ownerKey;

		const fabricMspMap = {
			manufacturerMSP: 'ManufacturerOrgMSP',
			distributorMSP: 'DistributorOrgMSP',
			retailerMSP: 'RetailerOrgMSP',
			transporterMSP: 'TransporterOrgMSP',
			consumerMSP: 'ConsumerOrgMSP',
			EdaOrgMSP: 'EdaOrgMSP'
		};
		if (fabricMspMap[ownerKey]) {
			return fabricMspMap[ownerKey];
		}
		if (ownerKey.endsWith('OrgMSP')) {
			return ownerKey;
		}

		const companyData = await PharmanetHelper.getAssetData(ctx, ownerKey);
		if (!companyData || !companyData.organisationRole) {
			return 'ConsumerOrgMSP';
		}
		return PharmanetHelper.roleToOwnerMsp(companyData.organisationRole);
	}

	static async buildPouchRecord(ctx, drug) {
		const ownerMsp = await PharmanetHelper.resolveOwnerMsp(ctx, drug.owner);
		const status = drug.status || PharmanetHelper.statusFromOwnerMsp(ownerMsp);
		const pouch = {
			docType: 'medicine_pouch',
			gtin: drug.gtin,
			batchNo: drug.batchNo,
			drugName: drug.name || drug.drugName,
			serialNumber: drug.serialNumber,
			price: drug.price !== undefined && drug.price !== null ? Number(drug.price) : null,
			owner: ownerMsp,
			status: status
		};
		if (drug.expiryDate) {
			pouch.expiryDate = PharmanetHelper.formatDateValue(drug.expiryDate);
		}
		if (drug.manufacturingDate || drug.manufactureDate) {
			pouch.manufactureDate = PharmanetHelper.formatDateValue(drug.manufacturingDate || drug.manufactureDate);
		}
		if (drug.rcReferenceCid) pouch.rcReferenceCid = drug.rcReferenceCid;
		if (drug.coaReferenceCid) pouch.coaReferenceCid = drug.coaReferenceCid;
		return pouch;
	}

	static async syncPouchRecord(ctx, drug) {
		if (!drug.gtin || !drug.serialNumber) return;
		const pouchKey = PharmanetHelper.getPouchKey(drug.gtin, drug.serialNumber);
		const pouch = await PharmanetHelper.buildPouchRecord(ctx, drug);
		await ctx.stub.putState(pouchKey, Buffer.from(JSON.stringify(pouch)));
	}

  	/**
	 * Helper function to construct Purchase Order composite key
	 * @param ctx - The transaction context object
     * @param buyerCRN - Company Registration Number of buyer
     * @param drugName - Name of the drug
	 * @returns
	 */
	static getPOKey(ctx, buyerCRN, gtin) {
		return ctx.stub.createCompositeKey(pharmaNamespaces.PurchaseOrder, [buyerCRN, gtin]);
	}

	static getShipmentKey(ctx, buyerCRN, gtin) {
		return ctx.stub.createCompositeKey(pharmaNamespaces.Shipment, [buyerCRN, gtin]);
	}

  	/**
	 * Helper function to convert date to string
	 * @param dateString - String representation of date
	 * @returns
	 */
	static getDateFromString(dateString) {
		return new Date(dateString);
	}

	static parseCompositeKeyParts(stub, compositeKey) {
		try {
			const parsed = stub.splitCompositeKey(compositeKey);
			return parsed.attributes || [];
		} catch (error) {
			return [];
		}
	}

	static normalizeDateValue(value) {
		if (!value) {
			return null;
		}
		if (value instanceof Date) {
			return value.toISOString();
		}
		return value;
	}

	static async enrichCompanyReference(ctx, companyKey) {
		if (!companyKey) {
			return {
				companyKey: null,
				companyCRN: null,
				companyName: null,
				organisationRole: null
			};
		}

		const parts = PharmanetHelper.parseCompositeKeyParts(ctx.stub, companyKey);
		const company = await PharmanetHelper.getAssetData(ctx, companyKey);

		return {
			companyKey,
			companyCRN: parts[0] || null,
			companyName: (company && company.name) || parts[1] || null,
			organisationRole: company && company.organisationRole ? company.organisationRole : null
		};
	}

	static async findCompanyByIdentifier(ctx, companyIdentifier) {
		if (!companyIdentifier || !companyIdentifier.trim()) {
			throw new Error('Company identifier (CRN or name) is required.');
		}

		const search = companyIdentifier.trim();
		const searchUpper = search.toUpperCase();
		const searchLower = search.toLowerCase();
		const companies = await PharmanetHelper.iterateCompanies(ctx);

		let partialMatch = null;

		for (const entry of companies) {
			const parts = PharmanetHelper.parseCompositeKeyParts(ctx.stub, entry.key);
			const companyCRN = parts[0] || '';
			const companyName = entry.data.name || parts[1] || '';

			if (companyCRN.toUpperCase() === searchUpper) {
				return {
					key: entry.key,
					data: entry.data,
					companyCRN,
					companyName
				};
			}

			if (companyName.toLowerCase() === searchLower) {
				return {
					key: entry.key,
					data: entry.data,
					companyCRN,
					companyName
				};
			}

			if (!partialMatch && companyName.toLowerCase().includes(searchLower)) {
				partialMatch = {
					key: entry.key,
					data: entry.data,
					companyCRN,
					companyName
				};
			}
		}

		if (partialMatch) {
			return partialMatch;
		}

		throw new Error(`No company found with CRN or name: ${search}`);
	}

	static async iteratePurchaseOrders(ctx) {
		const iterator = await ctx.stub.getStateByPartialCompositeKey(pharmaNamespaces.PurchaseOrder, []);
		const purchaseOrders = [];

		while (true) {
			const result = await iterator.next();
			if (result.value) {
				purchaseOrders.push({
					key: result.value.key,
					data: JSON.parse(result.value.value.toString('utf8'))
				});
			}
			if (result.done) {
				await iterator.close();
				break;
			}
		}

		return purchaseOrders;
	}

	static async iteratePouches(ctx, gtin = null) {
		const startKey = gtin ? `POUCH_${gtin}_` : 'POUCH_';
		const endKey = gtin ? `POUCH_${gtin}_\uffff` : 'POUCH_\uffff';
		const iterator = await ctx.stub.getStateByRange(startKey, endKey);
		const pouches = [];

		while (true) {
			const result = await iterator.next();
			if (result.value && result.value.value && result.value.value.length > 0) {
				const pouch = JSON.parse(result.value.value.toString('utf8'));
				if (pouch.docType === 'medicine_pouch') {
					pouches.push(pouch);
				}
			}
			if (result.done) {
				await iterator.close();
				break;
			}
		}

		return pouches;
	}

	static async resolvePouchOwnerDisplay(ctx, pouch) {
		if (!pouch || !pouch.owner) {
			return 'N/A';
		}

		if (!pouch.owner.includes('MSP')) {
			return pouch.owner;
		}

		if (pouch.ownerCompanyKey) {
			const companyName = await PharmanetHelper.resolveCompanyNameByKey(ctx, pouch.ownerCompanyKey);
			if (companyName) {
				return companyName;
			}
		}

		const companyName = await PharmanetHelper.resolveCompanyNameByMsp(ctx, pouch.owner);
		return companyName || pouch.owner;
	}

	static async pouchBelongsToCompany(ctx, pouch, company) {
		if (!pouch || !company) {
			return false;
		}

		if (pouch.ownerCompanyKey && pouch.ownerCompanyKey === company.key) {
			return true;
		}

		const companyMsp = PharmanetHelper.getFabricMspForRole(company.data.organisationRole);
		if (companyMsp && pouch.owner === companyMsp) {
			return !pouch.ownerCompanyKey || pouch.ownerCompanyKey === company.key;
		}

		return false;
	}

	static buildDrugUnitSummary(ctx, pouch) {
		return {
			gtin: pouch.gtin || null,
			serialNumber: pouch.serialNumber || null,
			batchNo: pouch.batchNo || null,
			drugName: pouch.drugName || null,
			price: pouch.price !== undefined && pouch.price !== null ? Number(pouch.price) : null,
			expiryDate: pouch.expiryDate ? PharmanetHelper.formatDateValue(pouch.expiryDate) : pouch.expiryDate || null,
			manufactureDate: pouch.manufactureDate
				? PharmanetHelper.formatDateValue(pouch.manufactureDate)
				: pouch.manufactureDate || null,
			status: pouch.status || 'UNKNOWN',
			ownerMSP: pouch.owner && pouch.owner.includes('MSP') ? pouch.owner : null,
			ownerCompanyKey: pouch.ownerCompanyKey || null,
			transporterCompanyKey: pouch.transporterCompanyKey || null,
			shipmentID: pouch.activeShipmentID
				|| (Array.isArray(pouch.shipment) && pouch.shipment.length ? pouch.shipment[pouch.shipment.length - 1] : null),
			rcReferenceCid: pouch.rcReferenceCid || null,
			coaReferenceCid: pouch.coaReferenceCid || null,
			updatedAt: PharmanetHelper.normalizeDateValue(pouch.updatedAt)
		};
	}

	static async buildDrugUnitView(ctx, pouch) {
		const summary = PharmanetHelper.buildDrugUnitSummary(ctx, pouch);
		summary.owner = await PharmanetHelper.resolvePouchOwnerDisplay(ctx, pouch);
		return summary;
	}
	
}

module.exports = PharmanetHelper;