'use strict';

/* This contract has all the business logic for transferring drugs on Pharma network */

const {Contract} = require('fabric-contract-api');
const PharmanetHelper = require('../utils/utils.js');
const DrugHelper = require('../utils/drugutils.js');

//Declare ENUMS, all CAPS followed for easy identification
const PHARMANETORGS = require('../enums/pharmaorgsenum.js');
const PHARMANETROLES = require('../enums/pharmarolesenum.js');

class TransferDrugContract extends Contract {

	constructor() {
		// Provide a custom name to refer to this smart contract
		super('org.pharma-network.pharmanet.transferdrugcontract');
	}

    /* ****** All custom functions are defined below ***** */

    /**
     * Upload and validate a drug Registration Certificate (RC) - EDA only
     * @param ctx - The transaction context object
     * @param gtin - Global Trade Item Number
     * @param ipfsHash - IPFS CID of the RC PDF document
     * @returns
     */
    async uploadDrugRC(ctx, gtin, ipfsHash) {
        if(PharmanetHelper.getRequestorOrg(ctx) !== PHARMANETORGS.EDA){
            throw new Error("Security denied: Only Egyptian Drug Authority (EDA) is authorized to upload drug Registration Certificates (RC).");
        }

        const rcKey = 'RC_' + gtin;
        const rcBytes = await ctx.stub.getState(rcKey);
        if(rcBytes && rcBytes.length > 0){
            throw new Error(`GTIN ${gtin} already has a Registration Certificate on the network.`);
        }

        const rcAsset = {
            docType: 'registration_certificate',
            gtin: gtin,
            ipfsHash: ipfsHash,
            approvedBy: PHARMANETORGS.EDA,
            status: 'VALIDATED',
            releaseDate: PharmanetHelper.getTxTimestampISO(ctx)
        };

        await ctx.stub.putState(rcKey, Buffer.from(JSON.stringify(rcAsset)));
        return rcAsset;
    }

    /**
     * Upload and approve a batch Certificate of Analysis (CoA) - EDA only
     * @param ctx - The transaction context object
     * @param batchNo - Batch number
     * @param gtin - Global Trade Item Number linked to the batch
     * @param ipfsHash - IPFS CID of the CoA PDF document
     * @returns
     */
    async uploadBatchCoA(ctx, batchNo, gtin, ipfsHash) {
        if(PharmanetHelper.getRequestorOrg(ctx) !== PHARMANETORGS.EDA){
            throw new Error("Security denied: Only Egyptian Drug Authority (EDA) is authorized to approve Certificates of Analysis (CoA).");
        }

        const rcKey = 'RC_' + gtin;
        const rcBytes = await ctx.stub.getState(rcKey);
        if(!rcBytes || rcBytes.length === 0){
            throw new Error(`Medical denial: Cannot approve batch for unregistered drug. GTIN ${gtin} has no Registration Certificate.`);
        }

        const coaKey = 'COA_' + batchNo;
        const coaBytes = await ctx.stub.getState(coaKey);
        if(coaBytes && coaBytes.length > 0){
            throw new Error(`Batch ${batchNo} already has a Certificate of Analysis on the network.`);
        }

        const coaAsset = {
            docType: 'certificate_of_analysis',
            batchNo: batchNo,
            gtin: gtin,
            ipfsHash: ipfsHash,
            approvedBy: PHARMANETORGS.EDA,
            status: 'APPROVED',
            releaseDate: PharmanetHelper.getTxTimestampISO(ctx)
        };

        await ctx.stub.putState(coaKey, Buffer.from(JSON.stringify(coaAsset)));
        return coaAsset;
    }
    
	/**
	 * Create a new purchase order on the network
	 * @param ctx - The transaction context object
     * @param buyerCRN - Company Registration Number of buyer
     * @param sellerCRN - Company Registration Number of seller
     * @param gtin - Global Trade Item Number of the drug
     * @param drugName - Display name of the drug
     * @param quantity - Quantity of pouches requested
	 * @returns
	 */
	async createPO(ctx, buyerCRN, sellerCRN, gtin, drugName, quantity){
		if(!([PHARMANETORGS.DISTRIBUTOR,PHARMANETORGS.RETAILER].includes(PharmanetHelper.getRequestorOrg(ctx)))){
			throw new Error("Only distributors or retailers are allowed to create purchase orders on pharma network!!!");
		}

        let buyerKey = await DrugHelper.getCompanyKey(ctx, buyerCRN, 'Buyer');

        let buyerRole = await PharmanetHelper.getCompanyRole(ctx, buyerKey);
        if(!([PHARMANETROLES.Distributor,PHARMANETROLES.Retailer].includes(buyerRole))){
            throw new Error("Given buyer CRN is not a distributor or retailer!!!");
        }

        let sellerKey = await DrugHelper.getCompanyKey(ctx, sellerCRN, 'Seller');

        let sellerRole = await PharmanetHelper.getCompanyRole(ctx, sellerKey);
        if(!([PHARMANETROLES.Manufacturer,PHARMANETROLES.Distributor].includes(sellerRole))){
            throw new Error("Given seller CRN is not a manufacturer or distributor!!!");
        }

        if(sellerRole + 1 !== buyerRole){
            throw new Error("Invalid purchase order. Distributors can buy only from manufacturers and retailers can purchase only from distributors!!!");
        }

        await DrugHelper.verifyGtin(ctx, gtin);

        let drugQuantity = parseInt(quantity);
        if(isNaN(drugQuantity)){
            throw new Error("Invalid quantity, it must be an integer value!!!");
        }

        const poKey = PharmanetHelper.getPOKey(ctx, buyerCRN, gtin);
        
        let newPOObject = {
            poID: poKey,
            gtin: gtin,
            drugName: drugName,
            quantity: drugQuantity,
            buyer: buyerKey,
            seller: sellerKey,
            createdAt: PharmanetHelper.getTxTimestampISO(ctx),
            updatedAt: PharmanetHelper.getTxTimestampISO(ctx)
        };

		await PharmanetHelper.putAssetData(ctx, poKey, newPOObject);

		return newPOObject;
    }
    
	/**
	 * Create a new shipment on the network
	 * @param ctx - The transaction context object
     * @param buyerCRN - Company Registration Number of buyer
     * @param gtin - Global Trade Item Number of the drug
     * @param listOfAssets - JSON array of pouch serial numbers being delivered
     * @param transporterCRN - Company Registration Number of transporter delivering the shipment
	 * @returns
	 */
	async createShipment(ctx, buyerCRN, gtin, listOfAssets, transporterCRN){
		if(!([PHARMANETORGS.MANUFACTURER,PHARMANETORGS.DISTRIBUTOR].includes(PharmanetHelper.getRequestorOrg(ctx)))){
			throw new Error("Only manufacturers or distributors are allowed to create shipments on pharma network!!!");
		}

        await DrugHelper.getCompanyKey(ctx, buyerCRN, 'Buyer');

        let transporterKey = await DrugHelper.getCompanyKey(ctx, transporterCRN, 'Transporter');

        let transporterRole = await PharmanetHelper.getCompanyRole(ctx, transporterKey);
        if(transporterRole !== PHARMANETROLES.Transporter){
            throw new Error("Given transporterCRN is not registered as transporter on pharma network!!!");
        }

        await DrugHelper.verifyGtin(ctx, gtin);

        const poKey = PharmanetHelper.getPOKey(ctx, buyerCRN, gtin);

        let purchaseOrder = await PharmanetHelper.getAssetData(ctx, poKey);

        if(!purchaseOrder){
            throw new Error("No purchase order exists for given buyer and GTIN!!!");
        }

        try{
            listOfAssets = JSON.parse(listOfAssets);
        } catch(error){
            throw new Error(`Failed to parse listOfAssets due to error - ${error}`);
        }

        if(!Array.isArray(listOfAssets)){
            throw new Error("Invalid listOfAssets passed as input. It must be an array of pouch serial numbers to be shipped!!!");
        }

        if(listOfAssets.length !== purchaseOrder.quantity){
            throw new Error(`Length of listOfAssets is ${listOfAssets.length} but quantity specified in purchase order is ${purchaseOrder.quantity}!!!`);
        }

        const sellerKey = purchaseOrder.seller;
        const sellerMsp = await DrugHelper.getFabricMspForCompany(ctx, sellerKey);
        const transporterMsp = await DrugHelper.getFabricMspForCompany(ctx, transporterKey);

        for(let serialNumber of listOfAssets){
            await DrugHelper.validatePouch(ctx, gtin, serialNumber, sellerMsp);            
        }

        const shipmentKey = PharmanetHelper.getShipmentKey(ctx, buyerCRN, gtin);

        let shippedPouches = await Promise.all(
            listOfAssets.map(
                serialNumber =>
                    DrugHelper.updatePouch(ctx, gtin, serialNumber, transporterMsp, 'IN_TRANSIT', {
                        shipmentID: shipmentKey,
                        ownerCompanyKey: transporterKey,
                        transporterCompanyKey: transporterKey
                    })
            )
        );
        
        let newShipmentObject = {
            shipmentID: shipmentKey,
            gtin: gtin,
            creator: sellerKey,
            assets: shippedPouches.map(pouch => PharmanetHelper.getPouchKey(gtin, pouch.serialNumber)),
            transporter: transporterKey,
            status: 'in-transit',
            createdAt: PharmanetHelper.getTxTimestampISO(ctx),
            updatedAt: PharmanetHelper.getTxTimestampISO(ctx)
        };

		await PharmanetHelper.putAssetData(ctx, shipmentKey, newShipmentObject);

		return newShipmentObject;
    }
    
	/**
	 * Update shipment once it is delivered
	 * @param ctx - The transaction context object
     * @param buyerCRN - Company Registration Number of buyer
     * @param gtin - Global Trade Item Number of the drug
     * @param transporterCRN - Company Registration Number of transporter delivering the shipment
	 * @returns
	 */
	async updateShipment(ctx, buyerCRN, gtin, transporterCRN){
		if(PharmanetHelper.getRequestorOrg(ctx) !== PHARMANETORGS.TRANSPORTER){
			throw new Error("Only transporters are allowed to update shipments on pharma network!!!");
		}

        let buyerKey = await DrugHelper.getCompanyKey(ctx, buyerCRN, 'Buyer');

        let transporterKey = await DrugHelper.getCompanyKey(ctx, transporterCRN, 'Transporter');

        let buyerRole = await PharmanetHelper.getCompanyRole(ctx, buyerKey);
        const receiveStatus = buyerRole === PHARMANETROLES.Retailer ? 'AVAILABLE' : 'IN_STORES';
        const buyerMsp = await DrugHelper.getFabricMspForCompany(ctx, buyerKey);

        await DrugHelper.verifyGtin(ctx, gtin);

        const shipmentKey = PharmanetHelper.getShipmentKey(ctx, buyerCRN, gtin);

        let shipment = await PharmanetHelper.getAssetData(ctx, shipmentKey);

        if(!shipment){
            throw new Error("No shipment exists for given buyer and GTIN!!!");
        }

        if(shipment.transporter !== transporterKey){
            throw new Error("Given transporterCRN is not the transporter of shipment for given buyer and GTIN!!!");
        }

        if(shipment.status !== 'in-transit'){
            throw new Error("Shipment of given GTIN is already delivered to buyer!!!");
        }

        let shippedPouchKeys = shipment.assets;

        let updatedPouches = await Promise.all(
            shippedPouchKeys.map(
                pouchKey => DrugHelper.updatePouchByKey(ctx, pouchKey, buyerMsp, receiveStatus, {
                    shipmentID: shipmentKey,
                    ownerCompanyKey: buyerKey
                })
            )
        );

        shipment.status = 'delivered';
        shipment.updatedAt = PharmanetHelper.getTxTimestampISO(ctx);

		await PharmanetHelper.putAssetData(ctx, shipmentKey, shipment);
        
        return updatedPouches;
    }

	/**
	 * Sell drug to a customer
	 * @param ctx - The transaction context object
     * @param gtin - Global Trade Item Number of the drug being sold
	 * @param serialNo - Serial number of the pouch being sold
     * @param retailerCRN - Company Registration Number of retailer
     * @param customerIDORName - Customer national ID or display name
	 * @returns
	 */
	async retailDrug(ctx, gtin, serialNo, retailerCRN, customerIDORName){
		if(PharmanetHelper.getRequestorOrg(ctx) !== PHARMANETORGS.RETAILER){
			throw new Error("Only retailers are allowed to sell drugs to customer on pharma network!!!");
		}

        let retailerKey = await DrugHelper.getCompanyKey(ctx, retailerCRN, 'Retailer');

        let retailerRole = await PharmanetHelper.getCompanyRole(ctx, retailerKey);
        if(retailerRole !== PHARMANETROLES.Retailer){
            throw new Error("Given retailerCRN is not registered as retailer on pharma network!!!");
        }

        const retailerMsp = await DrugHelper.getFabricMspForCompany(ctx, retailerKey);
        await DrugHelper.validatePouch(ctx, gtin, serialNo, retailerMsp);

        let purchasedPouch = await DrugHelper.updatePouch(ctx, gtin, serialNo, customerIDORName, 'DISPENSED', {
            ownerCompanyKey: null,
            transporterCompanyKey: null
        });

        return purchasedPouch;
	}        

}

module.exports = TransferDrugContract;
