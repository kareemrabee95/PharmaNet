'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

/**
 * queryDrugUnits(gtin, batchNo)
 */
class QueryDrugUnitsWorkload extends WorkloadModuleBase {

	constructor() {
		super();
		this.txIndex = 0;
		this.fixedDrug = null;
		this.identity = null;
	}

	async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
		await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

		this.txIndex = 0;
		this.identity = config.identity(roundArguments, 'EDA');   // RBAC: EDA / manufacturer / distributor / retailer
		const args = roundArguments || {};
		this.fixedDrug = (args.drugIndex !== undefined && args.drugIndex !== null && args.drugIndex !== '')
			? config.DRUGS[Number(args.drugIndex)]
			: null;
		if (args.drugIndex !== undefined && !this.fixedDrug) {
			throw new Error('queryDrugUnits: bad drugIndex ' + args.drugIndex);
		}
	}

	async submitTransaction() {
		this.txIndex++;
		const drug = this.fixedDrug || config.drugByIndex(this.txIndex + this.workerIndex);

		await this.sutAdapter.sendRequests({
			contractId: 'pharmanet',
			contractFunction: config.CONTRACTS.QUERY + ':queryDrugUnits',
			invokerIdentity: this.identity,
			contractArguments: [drug.gtin, drug.batchNo],
			readOnly: true
		});
	}
}

function createWorkloadModule() {
	return new QueryDrugUnitsWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
