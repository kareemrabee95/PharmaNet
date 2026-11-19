'use strict';

const PharmanetHelper = require('./utils.js');
const PHARMANETASSETS = require('../enums/pharmaassetsenum.js');

class DrugHelper {

    static async getCompanyKey(ctx, companyCRN, companyRole) {
        let company = await PharmanetHelper.getFirstAssetFromKeyPrefix(ctx, PHARMANETASSETS.Company, companyCRN);
        if (!company) {
            throw new Error(`${companyRole} with given company CRN is not registered on pharma network!!!`);
        }
        return company.key;
    }

    static getFabricMspForRole(organisationRole) {
        return PharmanetHelper.getFabricMspForRole(organisationRole);
    }

    static async getFabricMspForCompany(ctx, companyKey) {
        const company = await PharmanetHelper.getAssetData(ctx, companyKey);
        if (!company || !company.organisationRole) {
            throw new Error('Company record is invalid on pharma network.');
        }
        return DrugHelper.getFabricMspForRole(company.organisationRole);
    }

    static async verifyGtin(ctx, gtin) {
        const rcBytes = await ctx.stub.getState('RC_' + gtin);
        if (!rcBytes || rcBytes.length === 0) {
            throw new Error(`No registered drug found for GTIN ${gtin} on pharma network.`);
        }
    }

    static async getPouch(ctx, gtin, serialNumber) {
        const pouchKey = PharmanetHelper.getPouchKey(gtin, serialNumber);
        const pouchBytes = await ctx.stub.getState(pouchKey);
        if (!pouchBytes || pouchBytes.length === 0) {
            throw new Error(`Medicine pouch GTIN ${gtin} serial ${serialNumber} is not registered on pharma network.`);
        }
        return JSON.parse(pouchBytes.toString());
    }

    static async validatePouch(ctx, gtin, serialNumber, expectedOwnerMsp) {
        const pouch = await DrugHelper.getPouch(ctx, gtin, serialNumber);
        if (pouch.owner !== expectedOwnerMsp) {
            throw new Error(`Pouch ${gtin}/${serialNumber} cannot be transferred: current owner is ${pouch.owner}, expected ${expectedOwnerMsp}.`);
        }
        return pouch;
    }

    static normalizePouchOptions(options) {
        if (typeof options === 'string') {
            return { shipmentID: options };
        }
        if (options && typeof options === 'object') {
            return options;
        }
        return {};
    }

    static applyPouchMetadata(pouch, options = {}) {
        const shipmentID = options.shipmentID || options.activeShipmentID || null;

        if (shipmentID !== null) {
            pouch.shipment = pouch.shipment || [];
            pouch.shipment.push(shipmentID);
            pouch.activeShipmentID = shipmentID;
        }

        if (Object.prototype.hasOwnProperty.call(options, 'ownerCompanyKey')) {
            if (!options.ownerCompanyKey) {
                delete pouch.ownerCompanyKey;
            } else {
                pouch.ownerCompanyKey = options.ownerCompanyKey;
            }
        }

        if (Object.prototype.hasOwnProperty.call(options, 'transporterCompanyKey')) {
            if (!options.transporterCompanyKey) {
                delete pouch.transporterCompanyKey;
            } else {
                pouch.transporterCompanyKey = options.transporterCompanyKey;
            }
        }
    }

    static async updatePouch(ctx, gtin, serialNumber, newOwner, status, options = null) {
        const pouchKey = PharmanetHelper.getPouchKey(gtin, serialNumber);
        const pouch = await DrugHelper.getPouch(ctx, gtin, serialNumber);
        const normalizedOptions = DrugHelper.normalizePouchOptions(options);

        DrugHelper.applyPouchMetadata(pouch, normalizedOptions);

        pouch.owner = newOwner;
        if (status) {
            pouch.status = status;
        }
        pouch.updatedAt = PharmanetHelper.getTxTimestampISO(ctx);

        await ctx.stub.putState(pouchKey, Buffer.from(JSON.stringify(pouch)));
        return pouch;
    }

    static async updatePouchByKey(ctx, pouchKey, newOwner, status, options = null) {
        const pouchBytes = await ctx.stub.getState(pouchKey);
        if (!pouchBytes || pouchBytes.length === 0) {
            throw new Error(`Pouch key ${pouchKey} not found on pharma network.`);
        }
        const pouch = JSON.parse(pouchBytes.toString());
        return DrugHelper.updatePouch(ctx, pouch.gtin, pouch.serialNumber, newOwner, status, options);
    }

}

module.exports = DrugHelper;
