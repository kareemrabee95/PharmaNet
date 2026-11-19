'use strict';

/* This contract has all the business logic for Company and Drug registrations on Pharma network */

const { Contract } = require('fabric-contract-api');
const PharmanetHelper = require('../utils/utils.js');

// Declare ENUMS
const PHARMANETORGS = require('../enums/pharmaorgsenum.js');
const PHARMANETROLES = require('../enums/pharmarolesenum.js');

class RegistrationContract extends Contract {

    constructor() {
        // Provide a custom name to refer to this smart contract
        super('org.pharma-network.pharmanet.registrationcontract');
    }

    // Basic instantiation message
    async instantiate(ctx) {
        console.log('Pharmanet Smart Contract Instantiated');
    }

    /**
     * Register and Activate a new company on the network (EDA ONLY)
   
     */
    async registerCompany(ctx, companyCRN, companyName, location, organisationRole, licenseNumber) {
        if (PharmanetHelper.getRequestorOrg(ctx) !== PHARMANETORGS.EDA) {
            throw new Error("Security denied: Only Egyptian Drug Authority (EDA) is authorized to register and activate companies.");
        }

        const companyKey = PharmanetHelper.getCompanyKey(ctx, companyCRN, companyName);

        const companyBytes = await ctx.stub.getState(companyKey);
        if (companyBytes && companyBytes.length > 0) {
            throw new Error(`Conflict: Company with CRN ${companyCRN} and Name ${companyName} is already registered on PharmaNet!`);
        }

        if (!Object.prototype.hasOwnProperty.call(PHARMANETROLES, organisationRole)) {
            throw new Error("Invalid role provided for organization!!!");
        }

        let hierarchyKey = organisationRole === "Manufacturer" ? PHARMANETROLES.Manufacturer
                        : organisationRole === "Distributor" ? PHARMANETROLES.Distributor
                        : organisationRole === "Retailer" ? PHARMANETROLES.Retailer
                        : PHARMANETROLES.Transporter;

        // Company Object with Direct ACTIVE Status
        let newCompanyObject = {
            companyID: companyKey,
            name: companyName,
            location: location,
            organisationRole: organisationRole,
            hierarchyKey: hierarchyKey,
            licenseNumber: licenseNumber,
            registeredBy: PHARMANETORGS.EDA,
            status: 'ACTIVE',
            registeredAt: PharmanetHelper.getTxTimestampISO(ctx)
        };

        await PharmanetHelper.putAssetData(ctx, companyKey, newCompanyObject);

        return newCompanyObject;
    }

    /**
     * Register and produce individual medicine pouches for a batch (Licensed Manufacturer Only)
     * Logic: Verifies RC (Registration) and CoA (Analysis) before production.
     * @param companyCRN - Optional manufacturer CRN; when provided, validates that specific company is ACTIVE
     */
    async addDrug(ctx, gtin, batchNo, drugName, price, expiryDate, manufactureDate, serialsJson, companyCRN) {
        const manufacturer = await PharmanetHelper.validateActiveManufacturer(ctx, companyCRN || '');
        const clientMSP = ctx.clientIdentity.getMSPID();

        const unitPrice = parseFloat(price);
        if (isNaN(unitPrice) || unitPrice < 0) {
            throw new Error('Invalid price: must be a non-negative number.');
        }

        const rcKey = 'RC_' + gtin;
        const rcBytes = await ctx.stub.getState(rcKey);
        if (!rcBytes || rcBytes.length === 0) {
            throw new Error(`Rejected: Drug GTIN ${gtin} is not registered with the Egyptian Drug Authority (No RC found)`);
        }
        const rcData = JSON.parse(rcBytes.toString());

        // 3. Validate Certificate of Analysis (CoA)
        const coaKey = 'COA_' + batchNo;
        const coaBytes = await ctx.stub.getState(coaKey);
        if (!coaBytes || coaBytes.length === 0) {
            throw new Error(`Rejected: Batch ${batchNo} does not have an approved Certificate of Analysis (CoA not found).`);
        }
        const coaData = JSON.parse(coaBytes.toString());
        if (coaData.status !== 'APPROVED') {
            throw new Error(`Rejected: Certificate of Analysis for batch ${batchNo} is not approved.`);
        }

        // 4. Validate and Process Serials
        let serials;
        try {
            serials = JSON.parse(serialsJson);
        } catch (error) {
            throw new Error(`Failed to parse serialsJson: ${error.message}: ${error.message}`);
        }
        if (!Array.isArray(serials) || serials.length === 0) {
            throw new Error('serialsJson must be a non-empty JSON array..');
        }

        // 5. Create Pouch records with sovereign link
        for (const serial of serials) {
            const pouchKey = PharmanetHelper.getPouchKey(gtin, serial);
            if (await PharmanetHelper.isAssetExisting(ctx, pouchKey)) {
                throw new Error(`Rejected: Serial number ${serial} for GTIN ${gtin} is already registered.`);
            }

            const medicinePouch = {
                docType: 'medicine_pouch',
                gtin: gtin,
                batchNo: batchNo,
                drugName: drugName,
                price: unitPrice,
                expiryDate: expiryDate,
                manufactureDate: manufactureDate,
                serialNumber: serial,
                owner: clientMSP,
                ownerCompanyKey: manufacturer.key,
                status: 'PRODUCED',
                rcReferenceCid: rcData.ipfsHash, // Linked sovereign RC
                coaReferenceCid: coaData.ipfsHash // Linked sovereign CoA
            };

            await ctx.stub.putState(pouchKey, Buffer.from(JSON.stringify(medicinePouch)));
        }

        return `Production successful: ${serials.length} pouch(es) registered for batch ${batchNo} under the supervision of the EDA.`;
    }

}

module.exports = RegistrationContract;
