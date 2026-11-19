'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

/**
 * queryAllCompanies
 
 */
class QueryAllCompaniesWorkload extends WorkloadModuleBase {

	async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
		await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
		this.identity = config.identity(roundArguments, 'EDA');
	}

	async submitTransaction() {
		await this.sutAdapter.sendRequests({
			contractId: 'pharmanet',
			contractFunction: config.CONTRACTS.QUERY + ':queryAllCompanies',
			invokerIdentity: this.identity,
			contractArguments: [],
			readOnly: true
		});
	}
}

function createWorkloadModule() {
	return new QueryAllCompaniesWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
