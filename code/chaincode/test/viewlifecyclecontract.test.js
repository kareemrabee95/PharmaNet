'use strict';

const { expect } = require('chai');
const ViewLifecycleContract = require('../contracts/viewlifecyclecontract.js');
const PharmanetHelper = require('../utils/utils.js');

function createMockCtx(companies = {}, pouches = {}) {
	return {
		stub: {
			async getState(key) {
				if (pouches[key]) {
					return Buffer.from(JSON.stringify(pouches[key]));
				}
				if (companies[key]) {
					return Buffer.from(JSON.stringify(companies[key]));
				}
				return Buffer.from('');
			},
			getStateByPartialCompositeKey(namespace, parts) {
				const entries = Object.entries(companies).map(([key, data]) => ({
					key,
					value: Buffer.from(JSON.stringify(data))
				}));

				let index = 0;
				return {
					async next() {
						if (index >= entries.length) {
							return { done: true, value: null };
						}
						const entry = entries[index++];
						return {
							done: false,
							value: entry
						};
					},
					async close() {}
				};
			}
		}
	};
}

describe('ViewLifecycleContract owner display', () => {

	const manufacturerKey = '\x00org.pharma-network.pharmanet.company\x00MAN001\x00SUN-pharma\x00';
	const distributorKey = '\x00org.pharma-network.pharmanet.company\x00DIS001\x00VG-pharma\x00';
	const transporterKey = '\x00org.pharma-network.pharmanet.company\x00TRN001\x00SwiftLogistics\x00';

	const companies = {
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
		[transporterKey]: {
			name: 'SwiftLogistics',
			organisationRole: 'Transporter',
			status: 'ACTIVE'
		}
	};

	it('resolves distributor company name and transporter for delivered pouches', async () => {
		const ctx = createMockCtx(companies);
		const result = await ViewLifecycleContract.formatPouchFields(ctx, {
			docType: 'medicine_pouch',
			gtin: '06221000123456',
			batchNo: 'B-9942',
			drugName: 'Paracetamol',
			serialNumber: '001',
			price: 15.5,
			expiryDate: '2029-06-15',
			manufactureDate: '2026-06-15',
			owner: 'distributorMSP',
			ownerCompanyKey: distributorKey,
			transporterCompanyKey: transporterKey,
			status: 'IN_STORES',
			activeShipmentID: 'SHIPMENT_001',
			rcReferenceCid: 'QmRC',
			coaReferenceCid: 'QmCoA',
			updatedAt: '2026-06-18T14:49:34.553Z'
		}, '001');

		expect(result.schemaVersion).to.equal('3.0-owner-display');
		expect(result.owner).to.equal('VG-pharma');
		expect(result.ownerMSP).to.equal('distributorMSP');
		expect(result.transporter).to.equal('SwiftLogistics');
		expect(result.transporterMSP).to.equal('transporterMSP');
		expect(result.shipmentID).to.equal('SHIPMENT_001');
	});

	it('falls back to MSP lookup for legacy pouches without ownerCompanyKey', async () => {
		const ctx = createMockCtx(companies);
		const result = await ViewLifecycleContract.formatPouchFields(ctx, {
			docType: 'medicine_pouch',
			gtin: '06221000123456',
			batchNo: 'B-9942',
			drugName: 'Paracetamol',
			serialNumber: '002',
			price: 15.5,
			owner: 'manufacturerMSP',
			status: 'PRODUCED'
		}, '002');

		expect(result.owner).to.equal('SUN-pharma');
		expect(result.ownerMSP).to.equal('manufacturerMSP');
		expect(result.transporter).to.equal(null);
	});

	it('returns consumer name directly after retail', async () => {
		const ctx = createMockCtx(companies);
		const result = await ViewLifecycleContract.formatPouchFields(ctx, {
			docType: 'medicine_pouch',
			gtin: '06221000123456',
			batchNo: 'B-9942',
			drugName: 'Paracetamol',
			serialNumber: '003',
			price: 15.5,
			owner: 'Kareem',
			status: 'DISPENSED'
		}, '003');

		expect(result.owner).to.equal('Kareem');
		expect(result.ownerMSP).to.equal(null);
		expect(result.transporter).to.equal(null);
	});

	it('resolves company helpers from utils', async () => {
		const ctx = createMockCtx(companies);
		const byMsp = await PharmanetHelper.resolveCompanyNameByMsp(ctx, 'distributorMSP');
		const byKey = await PharmanetHelper.resolveCompanyNameByKey(ctx, transporterKey);
		expect(byMsp).to.equal('VG-pharma');
		expect(byKey).to.equal('SwiftLogistics');
	});

});
