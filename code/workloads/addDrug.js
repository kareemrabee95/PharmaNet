'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

/**
 * addDrug — ONE serial per transaction (JSON.stringify([serialNo])).
 
 */
class AddDrugWorkload extends WorkloadModuleBase {

	constructor() {
		super();
		this.txIndex = 0;
		this.manufacturerCRN = null;
		this.tag = '';
	}

	async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
		await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

		this.txIndex = 0;
		this.manufacturerCRN = config.manufacturerCRN(workerIndex, 1);
		this.tag = config.tagOf(roundArguments);

		console.log('[Worker ' + workerIndex + '] addDrug CRN=' + this.manufacturerCRN + ' tag="' + this.tag + '"');
	}

	async submitTransaction() {
		this.txIndex++;

		const drug = config.drugByIndex(this.txIndex);
		const serialNo = config.serialNo(this.workerIndex, this.txIndex, this.tag);

		await this.sutAdapter.sendRequests({
			contractId: 'pharmanet',
			contractFunction: config.CONTRACTS.REGISTRATION + ':addDrug',
			invokerIdentity: config.IDENTITIES.MANUFACTURER,
			contractArguments: [
				drug.gtin,
				drug.batchNo,
				drug.name,
				config.DEFAULT_PRICE,
				config.EXPIRY_DATE,
				config.MANUFACTURE_DATE,
				JSON.stringify([serialNo]),
				this.manufacturerCRN
			],
			readOnly: false
		});
	}
}

function createWorkloadModule() {
	return new AddDrugWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
