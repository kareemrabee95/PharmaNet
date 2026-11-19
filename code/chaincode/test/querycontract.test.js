'use strict';

const { expect } = require('chai');
const QueryContract = require('../contracts/querycontract.js');
const PharmanetHelper = require('../utils/utils.js');

function createMockCtx(state = {}) {
	return {
		stub: {
			splitCompositeKey(key) {
				const parts = key.split('\x00').filter(Boolean);
				return {
					objectType: parts[0],
					attributes: parts.slice(1)
				};
			},
			async getState(key) {
				if (!state[key]) {
					return Buffer.from('');
				}
				return Buffer.from(JSON.stringify(state[key]));
			},
			async getStateByPartialCompositeKey(namespace, parts) {
				const prefix = `\x00${namespace}\x00${parts.join('\x00')}`;
				const entries = Object.entries(state)
					.filter(([key, value]) => key.startsWith(prefix) || (parts.length === 0 && key.includes(namespace)))
					.map(([key, value]) => ({ key, value: Buffer.from(JSON.stringify(value)) }));

				let index = 0;
				return {
					async next() {
						if (index >= entries.length) {
							return { done: true, value: null };
						}
						const entry = entries[index++];
						return { done: false, value: entry };
					},
					async close() {}
				};
			},
			async getStateByRange(startKey, endKey) {
				const entries = Object.entries(state)
					.filter(([key]) => key >= startKey && key <= endKey)
					.map(([key, value]) => ({ key, value: Buffer.from(JSON.stringify(value)) }));

				let index = 0;
				return {
					async next() {
						if (index >= entries.length) {
							return { done: true, value: null };
						}
						const entry = entries[index++];
						return { done: false, value: entry };
					},
					async close() {}
				};
			}
		}
	};
}

describe('QueryContract', () => {
	const companyNamespace = 'org.pharma-network.pharmanet.company';
	const poNamespace = 'org.pharma-network.pharmanet.purchaseorder';
	const manufacturerKey = `\x00${companyNamespace}\x00MAN001\x00SUN-pharma\x00`;
	const distributorKey = `\x00${companyNamespace}\x00DIST001\x00VG-pharma\x00`;
	const poKey = `\x00${poNamespace}\x00DIST001\x0006221000123456\x00`;
	const rcKey = 'RC_06221000123456';
	const pouchKey = 'POUCH_06221000123456_001';

	const state = {
		[manufacturerKey]: {
			name: 'SUN-pharma',
			organisationRole: 'Manufacturer',
			status: 'ACTIVE'
		},
		[distributorKey]: {
			name: 'VG-pharma',
			organisationRole: 'Distributor',
			status: 'ACTIVE'
		},
		[rcKey]: {
			docType: 'registration_certificate',
			gtin: '06221000123456'
		},
		[poKey]: {
			poID: poKey,
			gtin: '06221000123456',
			drugName: 'Paracetamol',
			quantity: 1,
			buyer: distributorKey,
			seller: manufacturerKey,
			createdAt: '2026-06-15T10:00:00.000Z',
			updatedAt: '2026-06-15T10:00:00.000Z'
		},
		[pouchKey]: {
			docType: 'medicine_pouch',
			gtin: '06221000123456',
			serialNumber: '001',
			batchNo: 'B-9942',
			drugName: 'Paracetamol',
			price: 15.5,
			owner: 'distributorMSP',
			ownerCompanyKey: distributorKey,
			status: 'IN_STORES'
		}
	};

	it('queryAllCompanies returns role breakdown', async () => {
		const contract = new QueryContract();
		const result = await contract.queryAllCompanies(createMockCtx(state));

		expect(result.totalCompanies).to.equal(2);
		expect(result.roleBreakdown.Manufacturer).to.equal(1);
		expect(result.companies[0].companyName).to.be.oneOf(['SUN-pharma', 'VG-pharma']);
	});

	it('queryAllPOs enriches buyer and seller names', async () => {
		const contract = new QueryContract();
		const result = await contract.queryAllPOs(createMockCtx(state), '');

		expect(result.totalCount).to.equal(1);
		expect(result.purchaseOrders[0].buyerName).to.equal('VG-pharma');
		expect(result.purchaseOrders[0].sellerName).to.equal('SUN-pharma');
	});

	it('queryDrugUnits returns pouch inventory for GTIN', async () => {
		const contract = new QueryContract();
		const result = await contract.queryDrugUnits(createMockCtx(state), '06221000123456', '');

		expect(result.totalUnits).to.equal(1);
		expect(result.units[0].owner).to.equal('VG-pharma');
		expect(result.units[0].price).to.equal(15.5);
	});

	it('queryAllDrugsByCompanyCRN returns company inventory', async () => {
		const contract = new QueryContract();
		const result = await contract.queryAllDrugsByCompanyCRN(createMockCtx(state), 'DIST001');

		expect(result.companyName).to.equal('VG-pharma');
		expect(result.totalDrugUnits).to.equal(1);
		expect(result.drugUnits[0].serialNumber).to.equal('001');
	});

	it('findCompanyByIdentifier resolves by name', async () => {
		const ctx = createMockCtx(state);
		const company = await PharmanetHelper.findCompanyByIdentifier(ctx, 'VG-pharma');
		expect(company.companyCRN).to.equal('DIST001');
	});
});
