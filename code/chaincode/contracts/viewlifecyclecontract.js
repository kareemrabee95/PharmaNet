'use strict';

const {Contract} = require('fabric-contract-api');
const PharmanetHelper = require('../utils/utils.js');

class ViewLifecycleContract extends Contract {

	constructor() {
		super('org.pharma-network.pharmanet.viewlifecyclecontract');
	}

	static normalizeTimestamp(timestamp) {
		if (!timestamp) return new Date();

		const seconds = (typeof timestamp.seconds === 'object' && timestamp.seconds !== null)
			? (timestamp.seconds.low || 0)
			: (timestamp.seconds || 0);

		const nanos = timestamp.nanos || 0;
		return new Date((seconds * 1000) + Math.floor(nanos / 1000000));
	}

	static enrichRcData(data) {
		return {
			...data,
			details: 'Drug RC sovereignly approved. Product is safe and successfully registered.'
		};
	}

	static enrichCoaData(data) {
		return {
			...data,
			details: 'Batch samples have been tested at EDA facilities and the Certificate of Analysis (CoA) has been issued..'
		};
	}

	static isMspOwner(ownerValue) {
		return Boolean(ownerValue && ownerValue.includes('MSP'));
	}

	static isConsumerOwner(ownerValue) {
		return Boolean(ownerValue && !ViewLifecycleContract.isMspOwner(ownerValue));
	}

	static resolveShipmentId(data) {
		if (data.activeShipmentID) {
			return data.activeShipmentID;
		}
		if (Array.isArray(data.shipment) && data.shipment.length > 0) {
			return data.shipment[data.shipment.length - 1];
		}
		return null;
	}

	static async resolveOwnerDisplay(ctx, data) {
		if (!data || !data.owner) {
			return 'N/A';
		}

		if (ViewLifecycleContract.isConsumerOwner(data.owner)) {
			return data.owner;
		}

		if (data.ownerCompanyKey) {
			const companyName = await PharmanetHelper.resolveCompanyNameByKey(ctx, data.ownerCompanyKey);
			if (companyName) {
				return companyName;
			}
		}

		if (ViewLifecycleContract.isMspOwner(data.owner)) {
			const companyName = await PharmanetHelper.resolveCompanyNameByMsp(ctx, data.owner);
			if (companyName) {
				return companyName;
			}
		}

		return data.owner;
	}

	static async resolveTransporterInfo(ctx, data) {
		if (data.transporterCompanyKey) {
			const transporterName = await PharmanetHelper.resolveCompanyNameByKey(ctx, data.transporterCompanyKey);
			const transporterMSP = await PharmanetHelper.resolveCompanyMspByKey(ctx, data.transporterCompanyKey);
			return {
				transporter: transporterName,
				transporterMSP
			};
		}

		if (data.status === 'IN_TRANSIT' && ViewLifecycleContract.isMspOwner(data.owner)) {
			const transporterName = await PharmanetHelper.resolveCompanyNameByMsp(ctx, data.owner);
			return {
				transporter: transporterName,
				transporterMSP: data.owner
			};
		}

		return {
			transporter: null,
			transporterMSP: null
		};
	}

	static async formatPouchFields(ctx, data, serialNo) {
		const ownerDisplay = await ViewLifecycleContract.resolveOwnerDisplay(ctx, data);
		const ownerMSP = ViewLifecycleContract.isMspOwner(data.owner) ? data.owner : null;
		const transporterInfo = await ViewLifecycleContract.resolveTransporterInfo(ctx, data);

		return {
			schemaVersion: 'Drug Tracability lifecycle',
			docType: 'medicine_pouch',
			gtin: data.gtin,
			batchNo: data.batchNo,
			drugName: data.drugName,
			serialNumber: serialNo || data.serialNumber,
			price: data.price !== undefined && data.price !== null ? Number(data.price) : null,
			expiryDate: data.expiryDate ? PharmanetHelper.formatDateValue(data.expiryDate) : data.expiryDate,
			manufactureDate: data.manufactureDate
				? PharmanetHelper.formatDateValue(data.manufactureDate)
				: data.manufactureDate,
			owner: ownerDisplay,
			ownerMSP,
			transporter: transporterInfo.transporter,
			transporterMSP: transporterInfo.transporterMSP,
			status: data.status,
			shipmentID: ViewLifecycleContract.resolveShipmentId(data),
			rcReferenceCid: data.rcReferenceCid || null,
			coaReferenceCid: data.coaReferenceCid || null,
			updatedAt: data.updatedAt || null
		};
	}

	static async formatPouchData(ctx, data, serialNo) {
		if (data.docType === 'medicine_pouch') {
			return ViewLifecycleContract.formatPouchFields(ctx, data, serialNo);
		}
		const legacy = await PharmanetHelper.buildPouchRecord(ctx, { ...data, serialNumber: serialNo || data.serialNumber });
		return ViewLifecycleContract.formatPouchFields(ctx, legacy, serialNo);
	}

	static async collectFormattedHistory(ctx, assetKey, dataTransformer) {
		const iterator = await PharmanetHelper.getAssetHistory(ctx, assetKey);
		const entries = [];

		while (true) {
			const result = await iterator.next();
			if (result.value) {
				const keyModificationObject = result.value;
				const txId = keyModificationObject.txId || keyModificationObject.tx_id;
				const isDelete = keyModificationObject.is_delete || keyModificationObject.isDelete || false;
				const timestamp = ViewLifecycleContract.normalizeTimestamp(keyModificationObject.timestamp).toISOString();

				let data = null;
				if (!isDelete && keyModificationObject.value && keyModificationObject.value.length > 0) {
					const raw = JSON.parse(keyModificationObject.value.toString('utf8'));
					data = dataTransformer ? await dataTransformer(raw) : raw;
				}

				entries.push({ txId, timestamp, isDelete, data });
			}
			if (result.done) {
				await iterator.close();
				break;
			}
		}

		return entries;
	}

	/**
	 * View full lifecycle history for a medicine pouch
	 * @param ctx - Transaction context
	 * @param gtin - Global Trade Item Number
	 * @param serialNo - Serial number of the pouch
	 */
	async viewHistory(ctx, gtin, serialNo) {
		const pouchKey = PharmanetHelper.getPouchKey(gtin, serialNo);

		if (!await PharmanetHelper.isAssetExisting(ctx, pouchKey)) {
			throw new Error(`Medicine pouch with GTIN ${gtin} and serial ${serialNo} is not available on pharma network!!!`);
		}

		const currentPouch = await PharmanetHelper.getAssetData(ctx, pouchKey);
		let lifecycleHistory = [];

		const rcKey = 'RC_' + gtin;
		if (await PharmanetHelper.isAssetExisting(ctx, rcKey)) {
			const rcHistory = await ViewLifecycleContract.collectFormattedHistory(
				ctx, rcKey, (data) => ViewLifecycleContract.enrichRcData(data)
			);
			lifecycleHistory = lifecycleHistory.concat(rcHistory);
		}

		if (currentPouch.batchNo) {
			const coaKey = 'COA_' + currentPouch.batchNo;
			if (await PharmanetHelper.isAssetExisting(ctx, coaKey)) {
				const coaHistory = await ViewLifecycleContract.collectFormattedHistory(
					ctx, coaKey, (data) => ViewLifecycleContract.enrichCoaData(data)
				);
				lifecycleHistory = lifecycleHistory.concat(coaHistory);
			}
		}

		const pouchHistory = await ViewLifecycleContract.collectFormattedHistory(
			ctx,
			pouchKey,
			async (data) => ViewLifecycleContract.formatPouchData(ctx, data, serialNo)
		);
		lifecycleHistory = lifecycleHistory.concat(pouchHistory);

		lifecycleHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

		return lifecycleHistory;
	}

	/**
	 * View current state of a medicine pouch
	 * @param ctx - Transaction context
	 * @param gtin - Global Trade Item Number
	 * @param serialNo - Serial number of the pouch
	 */
	async viewDrugCurrentState(ctx, gtin, serialNo) {
		const pouchKey = PharmanetHelper.getPouchKey(gtin, serialNo);

		if (!await PharmanetHelper.isAssetExisting(ctx, pouchKey)) {
			throw new Error(`Medicine pouch with GTIN ${gtin} and serial ${serialNo} is not available on pharma network!!!`);
		}

		const pouch = await PharmanetHelper.getAssetData(ctx, pouchKey);
		return ViewLifecycleContract.formatPouchData(ctx, pouch, serialNo);
	}

}

module.exports = ViewLifecycleContract;
