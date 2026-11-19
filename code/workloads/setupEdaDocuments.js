'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

/**
 * EDA setup (RC / CoA uploads). Always run with ONE worker (worker 0 owns the uploads).

 */
class SetupEdaDocumentsWorkload extends WorkloadModuleBase {

	constructor() {
		super();
		this.setupTasks = [];
		this.taskIndex = 0;
		this.phaseDone = false;
		this.isStandby = false;
		this.phase = 'all';
		this._fabricLock = Promise.resolve();
		this._holdPromise = null;
	}

	async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
		await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

		this.taskIndex = 0;
		this.phaseDone = false;
		this._fabricLock = Promise.resolve();
		this._holdPromise = null;
		this.phase = (roundArguments && roundArguments.phase) || 'all';
		this.setupTasks = [];

		if (workerIndex !== 0) {
			this.isStandby = true;
			console.log('[Worker ' + workerIndex + '] setupEdaDocuments idle (worker 0 owns uploads)');
			return;
		}

		this.isStandby = false;

		if (this.phase === 'rc' || this.phase === 'all') {
			for (const drug of config.DRUGS) {
				this.setupTasks.push({ type: 'rc', gtin: drug.gtin });
			}
		}
		if (this.phase === 'coa' || this.phase === 'all') {
			for (const drug of config.DRUGS) {
				this.setupTasks.push({ type: 'coa', batchNo: drug.batchNo, gtin: drug.gtin });
			}
		}
		if (this.phase === 'rcpo') {
			for (let k = 0; k < config.PO_GTIN_COUNT; k++) {
				this.setupTasks.push({ type: 'rc', gtin: config.poGtin(k) });
			}
		}

		console.log('[Worker 0] setupEdaDocuments phase=' + this.phase + ' tasks=' + this.setupTasks.length);
	}

	async submitTransaction() {
		if (this.isStandby) {
			return;
		}

		const step = async () => {
			if (this.phaseDone) {
				await this._holdUntilRoundEnd();
				return;
			}

			if (this.taskIndex >= this.setupTasks.length) {
				this.phaseDone = true;
				console.log('[setupEdaDocuments] phase ' + this.phase + ' complete (' + this.setupTasks.length + ' transactions)');
				await this._holdUntilRoundEnd();
				return;
			}

			const task = this.setupTasks[this.taskIndex];
			this.taskIndex++;
			await this._executeTask(task);
		};

		if (this.phase === 'rcpo') {
			// independent RC uploads: no ordering requirement, run in parallel
			await step();
		} else {
			await this._withFabricLock(step);
		}
	}

	_holdUntilRoundEnd() {
		if (!this._holdPromise) {
			this._holdPromise = new Promise(() => {});
		}
		return this._holdPromise;
	}

	async _withFabricLock(fn) {
		const previous = this._fabricLock;
		let release;
		this._fabricLock = new Promise((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await fn();
		} finally {
			release();
		}
	}

	async _executeTask(task) {
		let request;
		if (task.type === 'rc') {
			request = {
				contractId: 'pharmanet',
				contractFunction: config.CONTRACTS.TRANSFER + ':uploadDrugRC',
				invokerIdentity: config.IDENTITIES.EDA,
				contractArguments: [task.gtin, config.PLACEHOLDER_IPFS_RC],
				readOnly: false
			};
		} else {
			request = {
				contractId: 'pharmanet',
				contractFunction: config.CONTRACTS.TRANSFER + ':uploadBatchCoA',
				invokerIdentity: config.IDENTITIES.EDA,
				contractArguments: [task.batchNo, task.gtin, config.PLACEHOLDER_IPFS_COA],
				readOnly: false
			};
		}

		await this.sutAdapter.sendRequests(request);
	}
}

function createWorkloadModule() {
	return new SetupEdaDocumentsWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
