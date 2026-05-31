// Facilities Management & Cleaning template pack (see docs/09-vertical-deep-dive.md §2).
// Beacon vertical for FM and cleaning contractors, where client SLA evidence is the
// commercial driver. Covers SLA cleaning audits, fire & emergency-lighting compliance,
// planned preventive maintenance rounds and Legionella/water safety.
import type { TemplatePack } from "./types";

export const facilitiesPack: TemplatePack = {
  key: "facilities",
  name: "Facilities Management & Cleaning",
  industry: "facilities",
  description:
    "SLA cleaning quality audits, planned/preventive maintenance rounds and building compliance checks (fire equipment, emergency lighting and Legionella/water safety) for FM and cleaning contractors.",
  templates: [
    {
      key: "facilities.cleaning_quality_audit",
      name: "Cleaning Quality (SLA) Audit",
      category: "Quality audit",
      industry: "facilities",
      description: "Per-area cleaning audit scored against the client SLA standard with photo evidence.",
      scoringEnabled: true,
      sections: [
        {
          id: "context",
          title: "Audit context",
          questions: [
            { id: "site", label: "Select site / building", type: "siteSelect", required: true },
            { id: "area", label: "Area / room audited", type: "text", required: true, helpText: "e.g. Reception, Level 3 amenities, kitchen." },
            { id: "sla_standard", label: "SLA frequency met for this area", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Has the contracted cleaning frequency been delivered?" },
            { id: "date", label: "Audit date", type: "date", required: true },
          ],
        },
        {
          id: "scoring",
          title: "SLA standard scoring",
          description: "Score each element against the agreed SLA standard. Below standard items trigger a corrective action.",
          questions: [
            { id: "floors", label: "Floors — vacuumed/mopped, no marks", type: "multipleChoice", required: true, options: [{ label: "Above standard", score: 3 }, { label: "Meets standard", score: 2 }, { label: "Below standard", score: 0, flag: true }], triggersActionOnFail: true },
            { id: "surfaces", label: "Surfaces & furniture — dust-free", type: "multipleChoice", required: true, options: [{ label: "Above standard", score: 3 }, { label: "Meets standard", score: 2 }, { label: "Below standard", score: 0, flag: true }], triggersActionOnFail: true },
            { id: "washrooms", label: "Washrooms — clean, stocked, sanitised", type: "multipleChoice", required: true, options: [{ label: "Above standard", score: 3 }, { label: "Meets standard", score: 2 }, { label: "Below standard", score: 0, flag: true }], triggersActionOnFail: true },
            { id: "waste", label: "Waste bins emptied & liners replaced", type: "passFailNA", triggersActionOnFail: true },
            { id: "glass", label: "Glass / mirrors smear-free", type: "passFailNA" },
            { id: "evidence_photo", label: "Photo evidence of result", type: "photo", required: true },
            { id: "notes", label: "Defects / rectification notes", type: "text" },
          ],
        },
        {
          id: "signoff",
          title: "Sign-off",
          questions: [
            { id: "auditor", label: "Auditor name", type: "text", required: true },
            { id: "client_present", label: "Client representative present?", type: "passFailNA" },
            { id: "signature", label: "Auditor signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "facilities.fire_equipment_check",
      name: "Fire Equipment Check",
      category: "Fire compliance",
      industry: "facilities",
      description: "Monthly visual check of a fire extinguisher: pressure, seal, service tag and accessibility.",
      scoringEnabled: true,
      sections: [
        {
          id: "asset",
          title: "Extinguisher",
          questions: [
            { id: "asset", label: "Scan extinguisher QR / asset tag", type: "assetScan", required: true },
            { id: "type", label: "Extinguisher type", type: "multipleChoice", required: true, options: [{ label: "Water" }, { label: "Foam" }, { label: "CO₂" }, { label: "Dry powder" }, { label: "Wet chemical" }] },
          ],
        },
        {
          id: "checks",
          title: "Condition checks",
          questions: [
            { id: "pressure", label: "Pressure gauge in green / charged", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "pressure_reading", label: "Gauge reading", type: "number", unit: "bar", helpText: "Record only if a numeric gauge is fitted." },
            { id: "seal", label: "Tamper seal & safety pin intact", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "body", label: "Body — no corrosion, dents or damage", type: "passFailNA", triggersActionOnFail: true },
            { id: "accessible", label: "Mounted, signed and unobstructed", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "service_tag_date", label: "Last service tag date", type: "date", required: true, helpText: "Date stamped on the maintenance tag." },
            { id: "next_due", label: "Next service due", type: "date", required: true },
            { id: "defect_photo", label: "Photo of any defect", type: "photo", visibleWhen: { questionId: "pressure", equals: "fail" } },
          ],
        },
        {
          id: "result",
          title: "Result",
          questions: [
            { id: "serviceable", label: "Extinguisher serviceable?", type: "multipleChoice", required: true, options: [{ label: "Yes" }, { label: "No — remove from service", flag: true }] },
            { id: "technician", label: "Technician signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "facilities.emergency_lighting_test",
      name: "Emergency Lighting Test",
      category: "Fire compliance",
      industry: "facilities",
      description: "Functional test of an emergency light fitting: illuminates on test, duration and battery.",
      scoringEnabled: true,
      sections: [
        {
          id: "asset",
          title: "Fitting",
          questions: [
            { id: "asset", label: "Scan light fitting asset tag", type: "assetScan", required: true },
            { id: "location", label: "Fitting location", type: "text", required: true, helpText: "e.g. Exit above stairwell door, Level 2." },
            { id: "test_type", label: "Test type", type: "multipleChoice", required: true, options: [{ label: "Monthly flick test" }, { label: "Annual full duration" }] },
          ],
        },
        {
          id: "test",
          title: "Test results",
          questions: [
            { id: "illuminates", label: "Illuminates when mains isolated", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "duration", label: "Duration sustained under test", type: "number", unit: "min", required: true, min: 90, helpText: "Must sustain the rated duration (typically ≥90 minutes)." },
            { id: "battery_ok", label: "Battery recharges & charge indicator healthy", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "lamp", label: "Lamp / LED fully functional", type: "passFailNA", triggersActionOnFail: true },
            { id: "lens", label: "Diffuser / exit pictogram clean & visible", type: "passFailNA" },
            { id: "next_due", label: "Next test due", type: "date", required: true },
          ],
        },
        {
          id: "signoff",
          title: "Sign-off",
          questions: [
            { id: "pass", label: "Fitting passed?", type: "multipleChoice", required: true, options: [{ label: "Pass" }, { label: "Fail — raise work order", flag: true }] },
            { id: "technician", label: "Technician signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "facilities.ppm_round",
      name: "Planned Preventive Maintenance Round",
      category: "Maintenance",
      industry: "facilities",
      description: "Scheduled PPM round across building assets with condition checks and meter readings.",
      scoringEnabled: true,
      sections: [
        {
          id: "round",
          title: "Round details",
          questions: [
            { id: "site", label: "Select site / building", type: "siteSelect", required: true },
            { id: "round_type", label: "PPM schedule", type: "multipleChoice", required: true, options: [{ label: "Weekly" }, { label: "Monthly" }, { label: "Quarterly" }, { label: "Annual" }] },
            { id: "date", label: "Round date", type: "date", required: true },
          ],
        },
        {
          id: "asset",
          title: "Asset checks",
          description: "Repeat per asset on the round: scan, read, assess condition.",
          questions: [
            { id: "asset", label: "Scan asset QR / plate", type: "assetScan", required: true },
            { id: "running_hours", label: "Running hours / meter reading", type: "number", unit: "hrs" },
            { id: "temp_reading", label: "Operating temperature", type: "number", unit: "°C", helpText: "Bearing/motor/plant temperature where applicable." },
            { id: "condition", label: "Overall condition", type: "multipleChoice", required: true, options: [{ label: "Good", score: 2 }, { label: "Fair — monitor", score: 1 }, { label: "Poor — action required", score: 0, flag: true }], triggersActionOnFail: true },
            { id: "leaks_noise", label: "Free of leaks, abnormal noise or vibration", type: "passFailNA", triggersActionOnFail: true },
            { id: "filters", label: "Filters / belts / lubrication serviced", type: "passFailNA" },
            { id: "asset_photo", label: "Photo of asset / defect", type: "photo" },
            { id: "next_due", label: "Next service due", type: "date" },
          ],
        },
        {
          id: "signoff",
          title: "Sign-off",
          questions: [
            { id: "summary", label: "Round summary / outstanding items", type: "text" },
            { id: "technician", label: "Technician name", type: "text", required: true },
            { id: "signature", label: "Technician signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "facilities.legionella_water_check",
      name: "Legionella / Water Safety Check",
      category: "Water compliance",
      industry: "facilities",
      description: "Monthly water safety check: outlet temperatures against safe ranges plus flushing of infrequently used outlets.",
      scoringEnabled: false,
      sections: [
        {
          id: "context",
          title: "Check context",
          questions: [
            { id: "site", label: "Select site / building", type: "siteSelect", required: true },
            { id: "system", label: "System / zone checked", type: "text", required: true, helpText: "e.g. Calorifier, sentinel outlets, cold water tank." },
            { id: "date", label: "Check date", type: "date", required: true },
          ],
        },
        {
          id: "temps",
          title: "Outlet temperatures",
          description: "Hot stored ≥60°C, hot at outlet ≥50°C within 1 min, cold ≤20°C. Out-of-range readings trigger a corrective action.",
          questions: [
            { id: "hot_stored", label: "Hot water stored (calorifier flow)", type: "temperature", unit: "°C", required: true, min: 60, max: 80, triggersActionOnFail: true },
            { id: "hot_return", label: "Hot water return temperature", type: "temperature", unit: "°C", min: 50, max: 80, triggersActionOnFail: true },
            { id: "hot_outlet", label: "Hot at sentinel outlet (after 1 min)", type: "temperature", unit: "°C", required: true, min: 50, max: 80, triggersActionOnFail: true },
            { id: "cold_outlet", label: "Cold at sentinel outlet (after 2 min)", type: "temperature", unit: "°C", required: true, min: 0, max: 20, triggersActionOnFail: true },
            { id: "tmv_check", label: "TMV blended outlets ≤43°C at point of use", type: "passFailNA", triggersActionOnFail: true },
          ],
        },
        {
          id: "controls",
          title: "Flushing & controls",
          questions: [
            { id: "flushing", label: "Infrequently used outlets flushed", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Little-used outlets flushed weekly to prevent stagnation." },
            { id: "tank_condition", label: "Cold water tank — lidded, clean, no debris", type: "passFailNA", triggersActionOnFail: true },
            { id: "next_due", label: "Next water safety check due", type: "date", required: true },
            { id: "responsible_person", label: "Responsible person name", type: "text", required: true },
            { id: "signature", label: "Responsible person signature", type: "signature", required: true },
          ],
        },
      ],
    },
  ],
};

export default facilitiesPack;
