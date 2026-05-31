// Retail (multi-site) template pack (see docs/09-vertical-deep-dive.md §2).
// For multi-store retail operators who care about brand consistency across sites.
// Covers store standards / brand audits, opening & closing, merchandising / planogram
// compliance and health & safety walks.
import type { TemplatePack } from "./types";

export const retailPack: TemplatePack = {
  key: "retail",
  name: "Retail (multi-site)",
  industry: "retail",
  description:
    "Store standards and brand audits, opening/closing checklists, merchandising/planogram compliance and loss prevention for multi-site retail operations.",
  templates: [
    {
      key: "retail.store_standards_audit",
      name: "Store Standards / Brand Audit",
      category: "Brand audit",
      industry: "retail",
      description: "Scored audit of store presentation, cleanliness, signage and staff presentation.",
      scoringEnabled: true,
      sections: [
        {
          id: "store",
          title: "Store & overview",
          questions: [
            { id: "store", label: "Select store", type: "siteSelect", required: true },
            { id: "audit_date", label: "Audit date", type: "date", required: true },
            { id: "frontage", label: "Window display & frontage on-brand", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "entrance_photo", label: "Photo of store entrance / frontage", type: "photo" },
          ],
        },
        {
          id: "presentation",
          title: "Presentation & cleanliness",
          questions: [
            { id: "cleanliness", label: "Overall cleanliness — floors, fixtures, glass", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "signage", label: "Signage current, correct & undamaged", type: "passFailNA", triggersActionOnFail: true, helpText: "Check promotional and statutory signage matches the current cycle." },
            { id: "lighting", label: "All lighting working (no blown globes)", type: "passFailNA" },
            { id: "fitting_rooms", label: "Fitting rooms tidy & mirrors clean", type: "passFailNA" },
            { id: "presentation_score", label: "Overall presentation rating", type: "multipleChoice", required: true, options: [{ label: "Excellent", score: 4 }, { label: "Good", score: 3 }, { label: "Acceptable", score: 2 }, { label: "Poor", score: 1, flag: true }] },
          ],
        },
        {
          id: "staff",
          title: "Staff & sign-off",
          questions: [
            { id: "uniform", label: "Staff in correct uniform & name badges", type: "passFailNA", triggersActionOnFail: true },
            { id: "greeting", label: "Customers greeted within standard time", type: "passFailNA", helpText: "Brand standard is acknowledgement within 30 seconds." },
            { id: "notes", label: "Auditor observations / actions", type: "text" },
            { id: "manager_name", label: "Store manager name", type: "text", required: true },
            { id: "signature", label: "Manager sign-off signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "retail.opening_closing",
      name: "Opening & Closing Checklist",
      category: "Daily operations",
      industry: "retail",
      description: "Start- and end-of-day routine covering alarms, tills/cash, lights, doors and safety.",
      scoringEnabled: false,
      sections: [
        {
          id: "context",
          title: "Shift details",
          questions: [
            { id: "store", label: "Select store", type: "siteSelect", required: true },
            { id: "shift_type", label: "Opening or closing?", type: "multipleChoice", required: true, options: [{ label: "Opening" }, { label: "Closing" }] },
            { id: "time", label: "Time completed", type: "datetime", required: true },
          ],
        },
        {
          id: "security",
          title: "Security & cash",
          questions: [
            { id: "alarm", label: "Alarm system disarmed/armed correctly", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Confirm alarm status matches the shift type before proceeding." },
            { id: "doors", label: "Entry/exit doors & shutters operational and secured", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "till_float", label: "Till floats counted & correct", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "safe", label: "Safe / cash drop reconciled", type: "passFailNA", triggersActionOnFail: true },
            { id: "cctv", label: "CCTV recording and screens live", type: "passFailNA" },
          ],
        },
        {
          id: "environment",
          title: "Environment & sign-off",
          questions: [
            { id: "lights", label: "Lights & signage set correctly for shift", type: "passFailNA" },
            { id: "heating", label: "Heating / cooling set to standard", type: "passFailNA" },
            { id: "hazards", label: "No outstanding hazards left on floor", type: "passFailNA", triggersActionOnFail: true },
            { id: "staff_member", label: "Completed by", type: "text", required: true },
            { id: "signature", label: "Signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "retail.merchandising_planogram",
      name: "Merchandising / Planogram Compliance",
      category: "Merchandising",
      industry: "retail",
      description: "Photo-evidenced check of planogram compliance, stock levels and pricing accuracy.",
      scoringEnabled: true,
      sections: [
        {
          id: "store",
          title: "Store & department",
          questions: [
            { id: "store", label: "Select store", type: "siteSelect", required: true },
            { id: "department", label: "Department / category reviewed", type: "text", required: true },
            { id: "planogram_ref", label: "Planogram reference / version", type: "text", helpText: "Enter the planogram version currently in effect for this cycle." },
          ],
        },
        {
          id: "compliance",
          title: "Planogram & stock",
          questions: [
            { id: "layout_match", label: "Fixture layout matches planogram", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "facings", label: "Correct number of facings per SKU", type: "passFailNA", triggersActionOnFail: true },
            { id: "stock_level", label: "Shelves filled / no significant gaps", type: "passFailNA", triggersActionOnFail: true },
            { id: "fefo", label: "Stock rotated (FIFO/FEFO), no out-of-date items", type: "passFailNA", triggersActionOnFail: true },
            { id: "planogram_photo", label: "Photo of bay / planogram as set", type: "photo", required: true },
          ],
        },
        {
          id: "pricing",
          title: "Pricing & sign-off",
          questions: [
            { id: "pricing_accuracy", label: "Shelf-edge labels & pricing accurate", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "promo_correct", label: "Promotional pricing & POS correct", type: "passFailNA", triggersActionOnFail: true },
            { id: "compliance_rating", label: "Overall compliance rating", type: "multipleChoice", required: true, options: [{ label: "Fully compliant", score: 3 }, { label: "Minor issues", score: 2 }, { label: "Major issues", score: 1, flag: true }] },
            { id: "signature", label: "Reviewer signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "retail.health_safety_round",
      name: "Health & Safety Walk",
      category: "Safety inspection",
      industry: "retail",
      description: "Routine safety walk covering clear aisles, fire exits, spill response and manual handling.",
      scoringEnabled: true,
      sections: [
        {
          id: "store",
          title: "Store",
          questions: [
            { id: "store", label: "Select store", type: "siteSelect", required: true },
            { id: "walk_date", label: "Walk date", type: "date", required: true },
          ],
        },
        {
          id: "floor",
          title: "Shop floor & access",
          questions: [
            { id: "aisles_clear", label: "Aisles & walkways clear of obstructions", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "fire_exits", label: "Fire exits unobstructed & doors openable", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Walk each exit route to the assembly point." },
            { id: "extinguishers", label: "Fire extinguishers present & in date", type: "passFailNA", triggersActionOnFail: true },
            { id: "spill_kit", label: "Spill kit stocked & spill response known", type: "passFailNA" },
            { id: "wet_floor", label: "Wet-floor signage available & in use", type: "passFailNA" },
          ],
        },
        {
          id: "handling",
          title: "Manual handling & sign-off",
          questions: [
            { id: "manual_handling", label: "Manual handling / lifting done correctly", type: "passFailNA", triggersActionOnFail: true },
            { id: "stockroom", label: "Stockroom tidy — no unstable stacks", type: "passFailNA", triggersActionOnFail: true },
            { id: "ladder", label: "Step ladders / kick stools in good condition", type: "passFailNA" },
            { id: "hazard_photo", label: "Photograph any hazard found", type: "photo" },
            { id: "manager_name", label: "Store manager name", type: "text", required: true },
            { id: "signature", label: "Manager sign-off signature", type: "signature", required: true },
          ],
        },
      ],
    },
  ],
};

export default retailPack;
