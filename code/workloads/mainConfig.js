'use strict';

/**
 * Shared Caliper benchmark constants for pharmanet chaincode.
 * Used by all workloads under benchmarks/scenario/simple/kareem/.
 *
 * DATASET RULE (important for valid results)
 *   The seed is ALWAYS built with SEED_WORKERS (=8) workers, whatever worker count the
 *   measured round later uses. So the ledger content is identical for 2W / 4W / 8W runs.
 *   Seed content:  8 x 250 = 2000 companies,  8 x 500 = 4000 pouches,  6 drugs (RC+CoA)
 *                  + PO_GTIN_COUNT extra GTINs (RC only) used as the createPO key space.
 */
module.exports = {
	DRUGS: [
		{ name: 'Paracetamol', gtin: '06221000123456', batchNo: 'B-CAL-001' },
		{ name: 'Fulmox', gtin: '06221000123457', batchNo: 'B-CAL-002' },
		{ name: 'Congestal', gtin: '06221000123458', batchNo: 'B-CAL-003' },
		{ name: 'Azithromycin', gtin: '06221000123459', batchNo: 'B-CAL-004' },
		{ name: 'Metformin', gtin: '06221000123460', batchNo: 'B-CAL-005' },
		{ name: 'Atorvastatin', gtin: '06221000123461', batchNo: 'B-CAL-006' }
	],

	DEFAULT_PRICE: '15.5',
	EXPIRY_DATE: '2029-06-15',
	MANUFACTURE_DATE: '2026-06-15',
	PO_QUANTITY: '10',
	NUM_BUYERS: 63,            // distributors per worker prefix in the seed pool
	NUM_DRUGS: 6,

	
	SEED_WORKERS: 8,
	COMPANIES_PER_WORKER: 250,   // 63 MAN + 63 DIST + 63 RET + 61 TRANS
	ADD_DRUG_TX_PER_WORKER: 500, // serials SN-{w}-1 .. SN-{w}-500 per seed worker

	
	PO_GTIN_COUNT: 200,

	PLACEHOLDER_IPFS_RC: 'QmPoL5nfvNEYMDaB72nj8un4ZjM2qTAbju9i98fAKcbSuT',
	PLACEHOLDER_IPFS_COA: 'QmQpfUjsPu9m6QR41HCRfLPCf5SyXuGM9THAZJDrFySCGe',

	CONTRACTS: {
		REGISTRATION: 'org.pharma-network.pharmanet.registrationcontract',
		TRANSFER: 'org.pharma-network.pharmanet.transferdrugcontract',
		VIEW: 'org.pharma-network.pharmanet.viewlifecyclecontract',
		QUERY: 'org.pharma-network.pharmanet.querycontract'
	},

	IDENTITIES: {
		EDA: 'Admin@eda',
		MANUFACTURER: '_manufacturerMSP_Admin@manufacturer',
		DISTRIBUTOR: '_distributorMSP_Admin@distributor',
		RETAILER: '_retailerMSP_Admin@retailer',
		TRANSPORTER: '_transporterMSP_Admin@transporter',
		CONSUMER: '_consumerMSP_Admin@consumer'
	},

	/** Research paper: selected workloads by expected efficiency tier */
	STRESS: {
		READ_HIGH: ['viewDrugCurrentState', 'queryAllCompanies', 'queryDrugUnits'],
		WRITE_HIGH: ['createPO', 'registerCompany', 'addDrug'],
		READ_HEAVY: ['viewHistory', 'queryAllDrugsByCompany', 'queryDrugStatusBreakdown'],
		WRITE_HEAVY: ['createShipment', 'transferDrug']
	},

	drugByIndex(index) {
		return this.DRUGS[index % this.DRUGS.length];
	},

	drugByName(name) {
		return this.DRUGS.find((entry) => entry.name === name) || this.DRUGS[0];
	},

	
	identity(roundArguments, defaultKey) {
		const key = (roundArguments && roundArguments.identity ? String(roundArguments.identity) : defaultKey).toUpperCase();
		if (!this.IDENTITIES[key]) {
			throw new Error('unknown identity "' + key + '" (use eda|manufacturer|distributor|retailer|transporter|consumer)');
		}
		return this.IDENTITIES[key];
	},

	/** round argument helpers */
	tagOf(roundArguments) {
		return (roundArguments && roundArguments.tag) ? String(roundArguments.tag) : '';
	},

	/**
	 * Serial number.  Empty tag  -> 'SN-{w}-{i}'      (seed; read workloads rely on this exact form)
	 *                 tag 'wr10' -> 'SN-wr10-{w}-{i}' (stress rounds: unique per round, no ambiguity)
	 */
	serialNo(workerIndex, txIndex, tag) {
		return tag
			? 'SN-' + tag + '-' + workerIndex + '-' + txIndex
			: 'SN-' + workerIndex + '-' + txIndex;
	},

	workerPrefix(workerIndex) {
		return 'W' + workerIndex;
	},

	manufacturerCRN(workerIndex, index) {
		const n = index || 1;
		const suffix = n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n;
		return this.workerPrefix(workerIndex) + '-MAN' + suffix;
	},

	distributorCRN(workerIndex, index) {
		const n = index || 1;
		const suffix = n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n;
		return this.workerPrefix(workerIndex) + '-DIST' + suffix;
	},

	transporterCRN(workerIndex, index) {
		const n = index || 1;
		const suffix = n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n;
		return this.workerPrefix(workerIndex) + '-TRANS' + suffix;
	},

	/** ---- createPO key space ------------------------------------------------------------ */

	/** extra GTIN k (0..PO_GTIN_COUNT-1): 14 digits, RC uploaded by setup-eda phase "rcpo" */
	poGtin(k) {
		return '06222' + String(k).padStart(9, '0');
	},

	get PO_DISTRIBUTORS() {
		return this.SEED_WORKERS * this.NUM_BUYERS;            // 504
	},

	get PO_CAPACITY() {
		return this.PO_DISTRIBUTORS * this.PO_GTIN_COUNT;      // 100,800 unique (buyer, gtin) pairs
	},

	/** global pair index p -> unique (buyerCRN, gtin). Injective for 0 <= p < PO_CAPACITY. */
	poPair(p) {
		if (p < 0 || p >= this.PO_CAPACITY) {
			throw new Error('PO key space exhausted (p=' + p + ', capacity=' + this.PO_CAPACITY + ')');
		}
		const d = p % this.PO_DISTRIBUTORS;
		const g = Math.floor(p / this.PO_DISTRIBUTORS);
		return {
			buyerCRN: this.distributorCRN(Math.floor(d / this.NUM_BUYERS), (d % this.NUM_BUYERS) + 1),
			gtin: this.poGtin(g),
			drugName: 'PO-Drug-' + g
		};
	},

	/** (kept for the legacy allfunction.yaml) */
	createPOTxNumber(workers) {
		return 63 * 6 * workers;
	},

	registerCompanyTxNumber(workers) {
		return this.COMPANIES_PER_WORKER * workers;
	},

	shipmentRoundTxNumber(workers) {
		return this.DRUGS.length * workers;
	},

	drugIndicesForWorker(workerIndex, totalWorkers) {
		const drugCount = this.DRUGS.length;
		const slots = Math.min(totalWorkers, drugCount);
		if (workerIndex >= slots) {
			return [];
		}
		const indices = [];
		for (let i = 0; i < drugCount; i++) {
			if (i % slots === workerIndex) {
				indices.push(i);
			}
		}
		return indices;
	}
};
