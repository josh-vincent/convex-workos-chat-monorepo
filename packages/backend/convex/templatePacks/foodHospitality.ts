// Food, Hospitality & Grocery template pack (see docs/09-vertical-deep-dive.md §2).
// Beachhead vertical #2. Covers HACCP food-safety management — fridge/freezer monitoring,
// cook/cool/reheat temperature control, cleaning & sanitation, opening checks and
// goods-inwards acceptance for restaurants, cafés, QSRs, caterers and grocers.
import type { TemplatePack } from "./types";

export const foodHospitalityPack: TemplatePack = {
  key: "food_hospitality",
  name: "Food, Hospitality & Grocery",
  industry: "food_hospitality",
  description:
    "HACCP-aligned food-safety records — fridge/freezer temperature control, cook/cool/reheat logs, cleaning & sanitation, hygiene and goods-inwards checks for food-handling sites.",
  templates: [
    {
      key: "food_hospitality.fridge_freezer_temp_log",
      name: "Fridge / Freezer Temperature Log",
      category: "Temperature monitoring",
      industry: "food_hospitality",
      description: "Per-shift temperature readings for cold-holding units with corrective action on out-of-range.",
      scoringEnabled: true,
      sections: [
        {
          id: "shift",
          title: "Shift details",
          questions: [
            { id: "site", label: "Select site", type: "siteSelect", required: true },
            { id: "checked_at", label: "Date & time of check", type: "datetime", required: true },
            { id: "shift", label: "Shift", type: "multipleChoice", required: true, options: [{ label: "Opening" }, { label: "Midday" }, { label: "Closing" }] },
          ],
        },
        {
          id: "fridges",
          title: "Refrigerators (1–5°C)",
          description: "Record the unit's digital display or a probe reading. Safe range 1–5°C.",
          questions: [
            { id: "fridge_walkin", label: "Walk-in chiller temp", type: "temperature", unit: "°C", min: 1, max: 5, required: true, triggersActionOnFail: true, helpText: "If above 5°C, move stock to a working unit and log corrective action." },
            { id: "fridge_prep", label: "Prep / line fridge temp", type: "temperature", unit: "°C", min: 1, max: 5, required: true, triggersActionOnFail: true },
            { id: "fridge_dessert", label: "Dessert / dairy fridge temp", type: "temperature", unit: "°C", min: 1, max: 5, triggersActionOnFail: true },
          ],
        },
        {
          id: "freezers",
          title: "Freezers (-22 to -15°C)",
          description: "Safe range -22°C to -15°C.",
          questions: [
            { id: "freezer_walkin", label: "Walk-in freezer temp", type: "temperature", unit: "°C", min: -22, max: -15, required: true, triggersActionOnFail: true },
            { id: "freezer_chest", label: "Chest freezer temp", type: "temperature", unit: "°C", min: -22, max: -15, triggersActionOnFail: true },
          ],
        },
        {
          id: "action",
          title: "Corrective action & sign-off",
          questions: [
            { id: "out_of_range", label: "Any unit out of range this check?", type: "passFailNA", required: true },
            { id: "corrective_action", label: "Corrective action taken", type: "text", visibleWhen: { questionId: "out_of_range", equals: "fail" }, helpText: "E.g. relocated stock, called refrigeration engineer, discarded affected product." },
            { id: "evidence_photo", label: "Photo of display / probe reading", type: "photo" },
            { id: "checked_by", label: "Checked by (name)", type: "text", required: true },
            { id: "signature", label: "Signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "food_hospitality.cook_cool_reheat_log",
      name: "Cook / Cool / Reheat Temperature Log",
      category: "Temperature monitoring",
      industry: "food_hospitality",
      description: "Core temperature and time records for cooking, cooling and reheating against the 2-hour/4-hour rule.",
      scoringEnabled: true,
      sections: [
        {
          id: "item",
          title: "Food item",
          questions: [
            { id: "food_item", label: "Food item / batch", type: "text", required: true },
            { id: "process", label: "Process", type: "multipleChoice", required: true, options: [{ label: "Cook" }, { label: "Cool" }, { label: "Reheat" }, { label: "Hot hold" }] },
          ],
        },
        {
          id: "cook",
          title: "Cook / reheat",
          description: "Cook and reheat to a core temperature of at least 75°C.",
          questions: [
            { id: "cook_temp", label: "Core temperature reached", type: "temperature", unit: "°C", min: 75, max: 100, required: true, triggersActionOnFail: true, helpText: "Must reach 75°C core (or equivalent time/temperature combination)." },
            { id: "cook_time", label: "Time core temp reached", type: "datetime", required: true },
          ],
        },
        {
          id: "cool",
          title: "Cooling (2-hour / 4-hour rule)",
          description: "Cool from 60°C to 21°C within 2 hours, then 21°C to 5°C within a further 4 hours.",
          questions: [
            { id: "cool_start_time", label: "Cooling start time", type: "datetime", visibleWhen: { questionId: "process", equals: "Cool" } },
            { id: "cool_2hr_temp", label: "Temp at 2 hours (target ≤21°C)", type: "temperature", unit: "°C", min: -5, max: 21, triggersActionOnFail: true, visibleWhen: { questionId: "process", equals: "Cool" } },
            { id: "cool_6hr_temp", label: "Temp at 6 hours (target ≤5°C)", type: "temperature", unit: "°C", min: -5, max: 5, triggersActionOnFail: true, visibleWhen: { questionId: "process", equals: "Cool" } },
            { id: "cool_pass", label: "Cooled within the 2-hour / 4-hour rule?", type: "passFailNA", triggersActionOnFail: true, visibleWhen: { questionId: "process", equals: "Cool" } },
          ],
        },
        {
          id: "signoff",
          title: "Result & sign-off",
          questions: [
            { id: "disposition", label: "Disposition", type: "multipleChoice", required: true, options: [{ label: "Safe — released" }, { label: "Re-cooked / re-heated" }, { label: "Discarded", flag: true }] },
            { id: "corrective_action", label: "Corrective action (if any)", type: "text" },
            { id: "handler", label: "Food handler name", type: "text", required: true },
            { id: "signature", label: "Signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "food_hospitality.daily_cleaning_checklist",
      name: "Daily Cleaning & Sanitation Checklist",
      category: "Cleaning & sanitation",
      industry: "food_hospitality",
      description: "End-of-day clean-down verification across food prep, equipment and front-of-house areas.",
      scoringEnabled: true,
      sections: [
        {
          id: "context",
          title: "Details",
          questions: [
            { id: "site", label: "Select site", type: "siteSelect", required: true },
            { id: "date", label: "Date", type: "date", required: true },
          ],
        },
        {
          id: "kitchen",
          title: "Kitchen & food prep",
          questions: [
            { id: "surfaces", label: "Prep surfaces cleaned & sanitised", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "equipment", label: "Slicers / mixers / equipment broken down & cleaned", type: "passFailNA", triggersActionOnFail: true },
            { id: "cooking", label: "Hobs, ovens, grills & extraction degreased", type: "passFailNA", triggersActionOnFail: true },
            { id: "floors", label: "Floors swept, mopped & drains cleared", type: "passFailNA" },
            { id: "fridges", label: "Fridge / freezer seals & interiors wiped", type: "passFailNA" },
          ],
        },
        {
          id: "foh_waste",
          title: "Front-of-house & waste",
          questions: [
            { id: "handwash", label: "Hand-wash stations cleaned & restocked", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "toilets", label: "Customer & staff toilets cleaned", type: "passFailNA" },
            { id: "bins", label: "Waste & recycling emptied, bin areas clean", type: "passFailNA", triggersActionOnFail: true },
            { id: "evidence_photo", label: "Photo evidence of cleaned areas", type: "photo" },
            { id: "notes", label: "Notes / outstanding items", type: "text" },
          ],
        },
        {
          id: "signoff",
          title: "Sign-off",
          questions: [
            { id: "completed_by", label: "Completed by (name)", type: "text", required: true },
            { id: "signature", label: "Signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "food_hospitality.haccp_verification",
      name: "HACCP Verification",
      category: "Food safety management",
      industry: "food_hospitality",
      description: "Periodic verification that critical control points, allergen controls and monitoring records are being maintained.",
      scoringEnabled: true,
      sections: [
        {
          id: "details",
          title: "Verification details",
          questions: [
            { id: "site", label: "Select site", type: "siteSelect", required: true },
            { id: "period", label: "Verification period", type: "text", required: true, helpText: "E.g. week commencing 26 May 2026." },
            { id: "verified_by", label: "Verified by (role)", type: "text", required: true },
          ],
        },
        {
          id: "ccps",
          title: "Critical control points",
          questions: [
            { id: "temp_records", label: "Cold-holding & cooking temperature logs complete", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "ccp_within_limits", label: "All CCPs within critical limits this period", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "monitoring_freq", label: "Monitoring carried out at required frequency", type: "passFailNA", triggersActionOnFail: true },
            { id: "calibration", label: "Probe thermometers calibrated & in date", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Verify against ice (0°C) / boiling (100°C) reference." },
          ],
        },
        {
          id: "allergens",
          title: "Allergen & cross-contamination controls",
          questions: [
            { id: "allergen_matrix", label: "Allergen matrix accurate & up to date", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "segregation", label: "Allergen segregation & dedicated equipment in use", type: "passFailNA", triggersActionOnFail: true },
            { id: "labelling", label: "Pre-packed (PPDS) labelling compliant", type: "passFailNA", triggersActionOnFail: true },
            { id: "raw_cooked", label: "Raw / ready-to-eat separation maintained", type: "passFailNA", triggersActionOnFail: true },
          ],
        },
        {
          id: "outcome",
          title: "Corrective actions & sign-off",
          questions: [
            { id: "deviations", label: "Deviations / corrective actions raised this period", type: "text", helpText: "Summarise any out-of-limit events and how they were closed out." },
            { id: "effective", label: "HACCP plan effective & no changes required?", type: "multipleChoice", required: true, options: [{ label: "Yes" }, { label: "No — review required", flag: true }] },
            { id: "signature", label: "Verifier signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "food_hospitality.opening_checklist",
      name: "Opening Checklist",
      category: "Pre-service",
      industry: "food_hospitality",
      description: "Start-of-day food-safety readiness check before service begins.",
      scoringEnabled: true,
      sections: [
        {
          id: "details",
          title: "Details",
          questions: [
            { id: "site", label: "Select site", type: "siteSelect", required: true },
            { id: "opened_at", label: "Date & time", type: "datetime", required: true },
          ],
        },
        {
          id: "hygiene",
          title: "Hygiene & facilities",
          questions: [
            { id: "handwash", label: "Hand-wash stations stocked (soap, towels, hot water)", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "fridge_spotcheck", label: "Fridge temperature spot-check", type: "temperature", unit: "°C", min: 1, max: 5, required: true, triggersActionOnFail: true, helpText: "Quick probe of a representative chiller before stock is used." },
            { id: "freezer_spotcheck", label: "Freezer temperature spot-check", type: "temperature", unit: "°C", min: -22, max: -15, triggersActionOnFail: true },
            { id: "pest_signs", label: "No signs of pests (droppings, gnawing, insects)", type: "passFailNA", required: true, triggersActionOnFail: true },
          ],
        },
        {
          id: "staff_stock",
          title: "Staff & stock",
          questions: [
            { id: "staff_health", label: "Staff health & fitness-to-work declaration completed", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "No staff reporting vomiting/diarrhoea in last 48h or open wounds uncovered." },
            { id: "uniform", label: "Staff in clean uniform, hair restrained, no jewellery", type: "passFailNA" },
            { id: "stock_dates", label: "Stock rotated (FIFO) — no out-of-date items in use", type: "passFailNA", triggersActionOnFail: true },
            { id: "issues_photo", label: "Photo of any issue found", type: "photo" },
          ],
        },
        {
          id: "signoff",
          title: "Sign-off",
          questions: [
            { id: "ready", label: "Site ready to open?", type: "multipleChoice", required: true, options: [{ label: "Yes" }, { label: "No — issues to resolve", flag: true }] },
            { id: "manager", label: "Opening manager name", type: "text", required: true },
            { id: "signature", label: "Signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "food_hospitality.delivery_acceptance",
      name: "Goods / Delivery Acceptance",
      category: "Goods inwards",
      industry: "food_hospitality",
      description: "Goods-inwards check of supplier deliveries with temperature, packaging and date verification before acceptance.",
      scoringEnabled: true,
      sections: [
        {
          id: "delivery",
          title: "Delivery details",
          questions: [
            { id: "received_at", label: "Date & time received", type: "datetime", required: true },
            { id: "supplier", label: "Supplier", type: "text", required: true },
            { id: "invoice", label: "Invoice / docket number", type: "text" },
            { id: "category", label: "Goods category", type: "multipleChoice", required: true, options: [{ label: "Chilled" }, { label: "Frozen" }, { label: "Ambient / dry" }, { label: "Mixed" }] },
          ],
        },
        {
          id: "checks",
          title: "Acceptance checks",
          questions: [
            { id: "chilled_temp", label: "Chilled goods delivery temp (≤5°C)", type: "temperature", unit: "°C", min: -1, max: 5, triggersActionOnFail: true, visibleWhen: { questionId: "category", notEquals: "Ambient / dry" }, helpText: "Probe between packs; do not pierce vacuum packs." },
            { id: "frozen_temp", label: "Frozen goods delivery temp (≤-15°C)", type: "temperature", unit: "°C", min: -30, max: -15, triggersActionOnFail: true, visibleWhen: { questionId: "category", notEquals: "Ambient / dry" } },
            { id: "packaging", label: "Packaging intact & undamaged", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "use_by", label: "Use-by / best-before dates acceptable", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "vehicle_clean", label: "Delivery vehicle clean & no contamination risk", type: "passFailNA" },
          ],
        },
        {
          id: "decision",
          title: "Reject decision & sign-off",
          questions: [
            { id: "decision", label: "Accept or reject?", type: "multipleChoice", required: true, options: [{ label: "Accept" }, { label: "Partial reject", flag: true }, { label: "Reject", flag: true }] },
            { id: "reject_reason", label: "Reason for rejection", type: "text", visibleWhen: { questionId: "decision", notEquals: "Accept" } },
            { id: "reject_photo", label: "Photo of rejected / damaged goods", type: "photo", visibleWhen: { questionId: "decision", notEquals: "Accept" } },
            { id: "received_by", label: "Received by (name)", type: "text", required: true },
            { id: "signature", label: "Signature", type: "signature", required: true },
          ],
        },
      ],
    },
  ],
};

export default foodHospitalityPack;
