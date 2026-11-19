'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

/**
 * viewDrugCurrentState — reads seeded pouches SN-{w}-{1..500} (worker w only touches its own serials).
 * A missing pouch is now a real failure (previously a swallowed "does not exist" could count as success).
 */
class ViewDrugCurrentStateWorkload extends WorkloadModuleBase {

	constructor() {
		super();
		this.txIndex = 0;
		this.maxSerialPerWorker = config.ADD_DRUG_TX_PER_WORKER;
		this.identity = null;
	}

	async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
		await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

		this.txIndex = 0;
		this.identity = config.identity(roundArguments, 'CONSUMER');   // pass identity: consumer to use the consumer-facing path
		const args = roundArguments || {};
		if (args.maxSerialPerWorker) {
			this.maxSerialPerWorker = Number(args.maxSerialPerWorker);
		}
	}

	async submitTransaction() {
		this.txIndex++;

		const txIdx = ((this.txIndex - 1) % this.maxSerialPerWorker) + 1;
		const serialNo = config.serialNo(this.workerIndex, txIdx, '');
		const drug = config.drugByIndex(txIdx);

		await this.sutAdapter.sendRequests({
			contractId: 'pharmanet',
			contractFunction: config.CONTRACTS.VIEW + ':viewDrugCurrentState',
			invokerIdentity: this.identity,
			contractArguments: [drug.gtin, serialNo],
			readOnly: true
		});
	}
}

function createWorkloadModule() {
	return new ViewDrugCurrentStateWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
