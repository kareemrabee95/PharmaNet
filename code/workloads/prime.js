'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

/**
 * prime — wakes the chaincode up after a fresh install WITHOUT changing the ledger.
 * Chaincode containers are built/started lazily on the first transaction (npm install inside the image can
 * take a minute or more on every peer). The first transactions of a run would otherwise time out or be slow.
 * This submits queryAllCompanies as a normal transaction (full endorsement -> ordering -> commit path) but it
 * writes nothing, so the dataset stays exactly the same. Failures in this round are expected at first and ignored.
 */
class PrimeWorkload extends WorkloadModuleBase {

	async submitTransaction() {
		await this.sutAdapter.sendRequests({
			contractId: 'pharmanet',
			contractFunction: config.CONTRACTS.QUERY + ':queryAllCompanies',
			invokerIdentity: config.IDENTITIES.EDA,
			contractArguments: [],
			readOnly: false
		});
	}
}

function createWorkloadModule() {
	return new PrimeWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
