'use strict';
const { makeLedger } = require('./harness');
const H = require('./utils/utils.js');
if (!H.getTxTimestampISO) H.getTxTimestampISO = () => '2026-01-01T00:00:00.000Z';   // shim: your newer utils.js has it
if (!H.getTxTimestamp) H.getTxTimestamp = () => new Date(0);
const Registration = require('./contracts/registrationcontract.js');
const Query = require('./contracts/querycontract.js');
const Transfer = require('./contracts/transferdrugcontract.js');

const gtin = '06221000123456', batch = 'B-CAL-001';
const mk = (L, msp) => ({ stub: L.stub, clientIdentity: { getMSPID: () => msp } });

async function build(N, P) {
  const L = makeLedger();
  const eda = mk(L, 'EdaOrgMSP'), man = mk(L, 'manufacturerMSP');
  const reg = new Registration();
  // companies through the REAL registerCompany (first 4 are the essentials, rest directly for speed)
  const roles = ['Manufacturer', 'Distributor', 'Retailer', 'Transporter'];
  await reg.registerCompany(eda, 'W0-MAN001', 'Manufacturer-W0-1', 'Cairo', 'Manufacturer', 'LIC-1');
  await reg.registerCompany(eda, 'W0-DIST001', 'Distributor-W0-1', 'Cairo', 'Distributor', 'LIC-2');
  for (let i = 2; i < N; i++) {
    const role = roles[i % 4];
    L.state.set(L.stub.createCompositeKey('org.pharma-network.pharmanet.company', ['C' + i, role + '-' + i]),
      JSON.stringify({ name: role + '-' + i, organisationRole: role, status: 'ACTIVE' }));
  }
  L.state.set('RC_' + gtin, JSON.stringify({ docType: 'registration_certificate', gtin, ipfsHash: 'Qm1', status: 'VALIDATED' }));
  L.state.set('COA_' + batch, JSON.stringify({ docType: 'certificate_of_analysis', batchNo: batch, gtin, ipfsHash: 'Qm2', status: 'APPROVED' }));
  for (let s = 1; s <= P; s++) await reg.addDrug(man, gtin, batch, 'X', '15.5', '2029-06-15', '2026-06-15', JSON.stringify(['SN-0-' + s]), 'W0-MAN001');
  return { L, eda, man, reg };
}
const fmt = (c) => `iterOpen=${c.iterOpen} iterNext=${c.iterNext} getState=${c.getState} putState=${c.putState} parse=${c.jsonParse}`;

(async () => {
  console.log('--- single-transaction costs (N=2000 companies, P=667 pouches)');
  const { L, eda, man, reg } = await build(2000, 667);
  const pouch = JSON.parse(L.state.get('POUCH_' + gtin + '_SN-0-1'));
  console.log('pouch created by the real addDrug has: owner=' + pouch.owner + '  ownerCompanyKey=' + (pouch.ownerCompanyKey ? 'SET' : 'MISSING'));

  L.reset(); await reg.registerCompany(eda, 'X-1', 'Name-X1', 'Cairo', 'Retailer', 'LIC'); console.log('registerCompany      ', fmt(L.c));
  L.reset(); await reg.addDrug(man, gtin, batch, 'X', '15.5', '2029-06-15', '2026-06-15', JSON.stringify(['SN-NEW-1']), 'W0-MAN001'); console.log('addDrug (1 serial)   ', fmt(L.c));
  L.reset(); await reg.addDrug(man, gtin, batch, 'X', '15.5', '2029-06-15', '2026-06-15', JSON.stringify(['A1','A2','A3','A4','A5']), 'W0-MAN001'); console.log('addDrug (5 serials)  ', fmt(L.c));
  const dist = mk(L, 'distributorMSP');
  // PO needs a distributor buyer + manufacturer seller
  L.reset(); await new Transfer().createPO(dist, 'W0-DIST001', 'W0-MAN001', gtin, 'X', '10'); console.log('createPO             ', fmt(L.c));
  const cons = mk(L, 'consumerMSP');
  L.reset(); await new Query().queryAllCompanies(cons); console.log('queryAllCompanies    ', fmt(L.c));
  L.restore();

  console.log('\n--- queryDrugUnits with pouches built by the real addDrug (ownerCompanyKey set)');
  console.log('N       P      ->  iterOpen iterNext getState parse');
  for (const [N, P] of [[500, 167], [1000, 333], [2000, 667], [2000, 1333], [8000, 667]]) {
    const b = await build(N, P);
    b.L.reset();
    const out = await new Query().queryDrugUnits(mk(b.L, 'consumerMSP'), gtin, batch);
    console.log(`${String(N).padEnd(7)} ${String(P).padEnd(6)} -> ${String(b.L.c.iterOpen).padStart(7)} ${String(b.L.c.iterNext).padStart(8)} ${String(b.L.c.getState).padStart(8)} ${String(b.L.c.jsonParse).padStart(6)}   units=${out.totalUnits !== undefined ? out.totalUnits : (out.units||[]).length}`);
    b.L.restore();
  }
})().catch(e => { console.error('ERR', e); process.exit(1); });
