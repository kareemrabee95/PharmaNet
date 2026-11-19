'use strict';

const registrationcontract = require('./contracts/registrationcontract.js');
const transferdrugcontract = require('./contracts/transferdrugcontract.js');
const viewlifecyclecontract = require('./contracts/viewlifecyclecontract.js');
const querycontract = require('./contracts/querycontract.js');
module.exports.contracts = [registrationcontract,transferdrugcontract,viewlifecyclecontract,querycontract];