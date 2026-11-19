'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

/**
 * createPO — every transaction creates a NEW purchase order.
 
 */
class CreatePOWorkload extends WorkloadModuleBase {

	constructor() {
		super();
		this.txIndex = 0;
		this.windowStart = 0;
		this.windowSize = 0;
		this.sellerCRN = null;
	}

	async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
		await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

		const args = roundArguments || {};
		this.windowStart = Number(args.windowStart);
		this.windowSize = Number(args.windowSize);
		if (!Number.isFinite(this.windowStart) || !Number.isFinite(this.windowSize) || this.windowSize <= 0) {
			throw new Error('createPO needs roundArguments.windowStart and windowSize (generate the YAML with gen-yaml.py)');
		}
		if (this.windowStart + this.windowSize > config.PO_CAPACITY) {
			throw new Error('createPO window exceeds PO key space (' + config.PO_CAPACITY + ')');
		}

		this.txIndex = 0;
		this.sellerCRN = config.manufacturerCRN(workerIndex, 1);

		console.log('[Worker ' + workerIndex + '] createPO window=[' + this.windowStart + ',' + (this.windowStart + this.windowSize) + ') seller=' + this.sellerCRN);
	}

	async submitTransaction() {
		const slot = this.txIndex * this.totalWorkers + this.workerIndex;
		this.txIndex++;

		if (slot >= this.windowSize) {
			throw new Error('createPO window exhausted (slot=' + slot + ', size=' + this.windowSize + ')');
		}

		const pair = config.poPair(this.windowStart + slot);

		await this.sutAdapter.sendRequests({
			contractId: 'pharmanet',
			contractFunction: config.CONTRACTS.TRANSFER + ':createPO',
			invokerIdentity: config.IDENTITIES.DISTRIBUTOR,
			contractArguments: [
				pair.buyerCRN,
				this.sellerCRN,
				pair.gtin,
				pair.drugName,
				config.PO_QUANTITY
			],
			readOnly: false
		});
	}
}

function createWorkloadModule() {
	return new CreatePOWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
