# chaincode-ops-counter

يشغّل ملفات الـchaincode الحقيقية على ledger وهمي في الذاكرة ويعدّ: getState / putState / iterator opens / iterator steps / JSON.parse
لكل دالة. ده دليل "reconcile Eqs. 3-10 with the code" لـ Reviewer 2 (3.1). مفيش Fabric ولا Docker مطلوب، بس Node.

## تجهيز
انسخ ملفاتك:
  utils.js drugutils.js                                  -> utils/
  querycontract.js transferdrugcontract.js registrationcontract.js -> contracts/
(الـenums/ هنا stubs بسيطة؛ ما بتأثرش على العدّ. لو utils.js عندك فيه getTxTimestampISO مش هيحتاج الـshim اللي في السكريبت.)

## تشغيل
    node count_ops.js

## القياس على الملفات اللي رفعتها (N شركات، P pouches في الـGTIN)
| الدالة | العمليات الفعلية | معادلة الورقة |
|---|---|---|
| registerCompany | 1R + 1W | Eq.3 = 1R+1W  ✔ |
| addDrug (serial واحد) | 1I + 3R + 1W | Eq.4 = 1I+3R+1W  ✔  (لو k serials: 1I + (2+k)R + kW => O(k) مش O(1)) |
| createPO | 2I + 3R + 1W | Eq.5 = 2I+5R+1W  ✘ (غيّرها أو وضّح طريقة العدّ) |
| queryAllCompanies | 1I بطول N + N parse | O(N) ✔ |
| queryDrugUnits | 1I بطول P + P getState + 2P parse (مستقل عن N) | Eq.8 = 1+P+|F|  ✔ تقريبًا (O(P)) |
