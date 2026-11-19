'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const config = require('./mainConfig.js');

const ROLE_DEFS = [
	{ role: 'Manufacturer', code: 'MAN' },
	{ role: 'Distributor', code: 'DIST' },
	{ role: 'Retailer', code: 'RET' },
	{ role: 'Transporter', code: 'TRANS' }
];

const LOCATIONS = [
	'Cairo', 'Alexandria', 'Giza', 'Nasr-City', 'Maadi', 'Zamalek', 'Heliopolis',
	'Alex', 'Dokki', '6-October', 'Luxor', 'Aswan', 'Suez', 'Mansoura', 'Tanta'
];

/**
 * registerCompany

 */
class RegisterCompanyWorkload extends WorkloadModuleBase {

	constructor() {
		super();
		this.txIndex = 0;
		this.workerCompanies = [];
		this.stressTag = '';
		this.stressMode = false;
		this.prefix = '';
	}

	async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
		await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

		this.stressTag = config.tagOf(roundArguments);
		this.stressMode = this.stressTag !== '';
		const workerPrefix = config.workerPrefix(workerIndex);
		this.prefix = this.stressMode
			? ('S-' + this.stressTag + '-' + workerPrefix)
			: workerPrefix;
		this.workerCompanies = [];
		this.txIndex = 0;

		if (!this.stressMode) {
			this.workerCompanies = this.buildSeedPool(this.prefix);
			console.log('[Worker ' + workerIndex + '] registerCompany seed pool=' + this.workerCompanies.length);
			return;
		}

		console.log('[Worker ' + workerIndex + '] registerCompany stress mode tag=' + this.stressTag);
	}

	buildSeedPool(prefix) {
		const byRole = {};
		for (const roleDef of ROLE_DEFS) {
			byRole[roleDef.code] = [];
			const count = roleDef.code === 'TRANS' ? 61 : 63;
			for (let i = 1; i <= count; i++) {
				byRole[roleDef.code].push(this.makeCompany(prefix, roleDef, i));
			}
		}

		// essentials first (MAN001, DIST001, RET001, TRANS001), then the rest
		const pool = [
			byRole.MAN[0],
			byRole.DIST[0],
			byRole.RET[0],
			byRole.TRANS[0]
		];
		for (const roleDef of ROLE_DEFS) {
			const count = roleDef.code === 'TRANS' ? 61 : 63;
			for (let i = 1; i < count; i++) {
				pool.push(byRole[roleDef.code][i]);
			}
		}
		return pool;
	}

	makeCompany(prefix, roleDef, index) {
		const suffix = index < 10 ? '00' + index : index < 100 ? '0' + index : '' + index;
		return {
			crn: prefix + '-' + roleDef.code + suffix,
			name: roleDef.role + '-' + prefix + '-' + index,
			location: LOCATIONS[(index - 1) % LOCATIONS.length],
			role: roleDef.role,
			licenseNumber: 'LIC-' + prefix + '-' + roleDef.code + suffix
		};
	}

	buildStressCompany(index) {
		const roleDef = ROLE_DEFS[index % ROLE_DEFS.length];
		const seq = index + 1;
		const suffix = 'STR' + String(seq).padStart(7, '0');
		return {
			crn: this.prefix + '-' + suffix,
			name: roleDef.role + '-' + this.prefix + '-' + seq,
			location: LOCATIONS[index % LOCATIONS.length],
			role: roleDef.role,
			licenseNumber: 'LIC-' + this.prefix + '-' + suffix
		};
	}

	async submitTransaction() {
		let company;
		if (this.stressMode) {
			company = this.buildStressCompany(this.txIndex);
			this.txIndex++;
		} else {
			if (this.txIndex >= this.workerCompanies.length) {
				throw new Error(
					'registerCompany seed pool exhausted for worker ' + this.workerIndex
					+ ' (pool=' + this.workerCompanies.length + '). The seed must run with 8 workers and txNumber=2000.'
				);
			}
			company = this.workerCompanies[this.txIndex];
			this.txIndex++;
		}

		await this.sutAdapter.sendRequests({
			contractId: 'pharmanet',
			contractFunction: config.CONTRACTS.REGISTRATION + ':registerCompany',
			invokerIdentity: config.IDENTITIES.EDA,
			contractArguments: [
				company.crn,
				company.name,
				company.location,
				company.role,
				company.licenseNumber
			],
			readOnly: false
		});
	}
}

function createWorkloadModule() {
	return new RegisterCompanyWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
