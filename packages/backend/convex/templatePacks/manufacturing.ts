// Manufacturing & Warehousing template pack (see docs/09-vertical-deep-dive.md §2).
// Beacon vertical #2. Covers 5S workplace audits, lockout/tagout (LOTO) verification,
// machine pre-use guarding checks, layered process audits (LPA) and in-process quality
// line audits. Designed for shop-floor use, often on shared / kiosk devices.
import type { TemplatePack } from "./types";

export const manufacturingPack: TemplatePack = {
  key: "manufacturing",
  name: "Manufacturing & Warehousing",
  industry: "manufacturing",
  description:
    "5S workplace audits, lockout/tagout (LOTO) verification, machine pre-use guarding checks, and quality / layered process audits for shop-floor and warehouse operations.",
  templates: [
    {
      key: "manufacturing.five_s_audit",
      name: "5S Workplace Audit",
      category: "Workplace organisation",
      industry: "manufacturing",
      description: "Scored Sort / Set in order / Shine / Standardize / Sustain walkthrough of a work area.",
      scoringEnabled: true,
      sections: [
        {
          id: "area",
          title: "Area details",
          questions: [
            { id: "site", label: "Select site", type: "siteSelect", required: true },
            { id: "area_name", label: "Work area / cell audited", type: "text", required: true },
            { id: "auditor", label: "Auditor name", type: "text", required: true },
            { id: "date", label: "Audit date", type: "date", required: true },
          ],
        },
        {
          id: "five_s",
          title: "5S scoring",
          description: "Score each pillar 0–5 against the area standard. Lower scores flag follow-up.",
          questions: [
            { id: "sort", label: "Sort — only needed items present, red-tag items removed", type: "slider", required: true, min: 0, max: 5, triggersActionOnFail: true, helpText: "0 = clutter / obsolete stock present, 5 = only what is needed remains." },
            { id: "set", label: "Set in order — a place for everything, shadow boards / labels", type: "slider", required: true, min: 0, max: 5, triggersActionOnFail: true },
            { id: "shine", label: "Shine — area clean, equipment maintained, leaks addressed", type: "slider", required: true, min: 0, max: 5, triggersActionOnFail: true },
            { id: "standardize", label: "Standardize — visual standards posted and followed", type: "slider", required: true, min: 0, max: 5, triggersActionOnFail: true },
            { id: "sustain", label: "Sustain — prior actions closed, habits maintained", type: "slider", required: true, min: 0, max: 5, triggersActionOnFail: true },
          ],
        },
        {
          id: "signoff",
          title: "Findings & sign-off",
          questions: [
            { id: "findings", label: "Findings / observations", type: "text" },
            { id: "evidence", label: "Photo evidence", type: "photo" },
            { id: "signature", label: "Auditor signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "manufacturing.loto_verification",
      name: "Lockout/Tagout (LOTO) Verification",
      category: "Energy isolation",
      industry: "manufacturing",
      description: "Verify all energy sources are isolated, locks and tags applied, and zero-energy state confirmed before servicing.",
      scoringEnabled: false,
      sections: [
        {
          id: "context",
          title: "Equipment & authorisation",
          questions: [
            { id: "asset", label: "Scan equipment QR", type: "assetScan", required: true },
            { id: "work_desc", label: "Work / service to be performed", type: "text", required: true },
            { id: "authorised_person", label: "Authorised (lock-holder) name", type: "text", required: true },
            { id: "permit_ref", label: "Associated permit / work order reference", type: "text" },
          ],
        },
        {
          id: "isolation",
          title: "Energy isolation",
          description: "Confirm every hazardous energy source has been identified and isolated.",
          questions: [
            { id: "sources_identified", label: "All energy sources identified (electrical, hydraulic, pneumatic, thermal, gravity, stored)", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Refer to the machine-specific energy control procedure." },
            { id: "electrical_isolated", label: "Electrical supply isolated at disconnect", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "stored_dissipated", label: "Stored energy released / blocked / restrained (capacitors, springs, pressure)", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "locks_applied", label: "Individual lock(s) applied to each isolation point", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "tags_applied", label: "Tags applied identifying lock-holder and date", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "lock_count", label: "Number of locks applied", type: "number", required: true, min: 1 },
          ],
        },
        {
          id: "verification",
          title: "Zero-energy verification",
          questions: [
            { id: "try_start", label: "Attempted start-up — machine does not operate (try-out)", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Return controls to off/neutral after testing." },
            { id: "zero_energy", label: "Zero-energy state verified with test instrument where applicable", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "verification_photo", label: "Photo of applied locks/tags", type: "photo" },
            { id: "verifier_sig", label: "Authorised person signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "manufacturing.machine_pre_use",
      name: "Machine Pre-Use / Guarding Check",
      category: "Machine safety",
      industry: "manufacturing",
      description: "Operator pre-use inspection of machine guarding, emergency stops and safety sensors.",
      scoringEnabled: true,
      sections: [
        {
          id: "machine",
          title: "Machine",
          questions: [
            { id: "asset", label: "Scan machine QR", type: "assetScan", required: true },
            { id: "operator", label: "Operator name", type: "text", required: true },
            { id: "shift", label: "Shift", type: "multipleChoice", options: [{ label: "Day" }, { label: "Afternoon" }, { label: "Night" }] },
          ],
        },
        {
          id: "guarding",
          title: "Guarding & safety devices",
          questions: [
            { id: "fixed_guards", label: "Fixed guards in place & secure", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "interlocks", label: "Interlocked guards stop machine when opened", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "estop", label: "Emergency stop(s) accessible & functional", type: "passFailNA", required: true, triggersActionOnFail: true, helpText: "Test each e-stop reaches a safe state." },
            { id: "light_curtain", label: "Light curtains / presence sensors active", type: "passFailNA", triggersActionOnFail: true },
            { id: "two_hand", label: "Two-hand controls / pull-backs functional (if fitted)", type: "passFailNA" },
            { id: "warning_labels", label: "Warning labels & signage legible", type: "passFailNA" },
            { id: "housekeeping", label: "Work zone clear of slip/trip hazards", type: "passFailNA", triggersActionOnFail: true },
            { id: "defect_photo", label: "Photo of any defect found", type: "photo", visibleWhen: { questionId: "fixed_guards", equals: "fail" } },
          ],
        },
        {
          id: "result",
          title: "Result",
          questions: [
            { id: "safe", label: "Machine safe to operate?", type: "multipleChoice", required: true, options: [{ label: "Yes" }, { label: "No — tag out & report", flag: true }] },
            { id: "operator_sig", label: "Operator signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "manufacturing.layered_process_audit",
      name: "Layered Process Audit (LPA)",
      category: "Process audit",
      industry: "manufacturing",
      description: "Scored verification that standardized work is being followed at a process / station.",
      scoringEnabled: true,
      sections: [
        {
          id: "context",
          title: "Audit context",
          questions: [
            { id: "site", label: "Select site", type: "siteSelect", required: true },
            { id: "process", label: "Process / station audited", type: "text", required: true },
            { id: "layer", label: "Audit layer", type: "multipleChoice", required: true, options: [{ label: "Layer 1 — Team leader" }, { label: "Layer 2 — Supervisor" }, { label: "Layer 3 — Plant manager" }] },
            { id: "auditor", label: "Auditor name", type: "text", required: true },
          ],
        },
        {
          id: "adherence",
          title: "Standardized work adherence",
          description: "Confirm the operator follows the documented standard. Non-conformances flag follow-up.",
          questions: [
            { id: "work_instruction", label: "Current work instruction available at station", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "sequence", label: "Operator follows defined work sequence", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "torque_settings", label: "Tools / settings match the standard (torque, speed, temp)", type: "passFailNA", triggersActionOnFail: true },
            { id: "ppe", label: "Required PPE worn correctly", type: "passFailNA", triggersActionOnFail: true },
            { id: "error_proofing", label: "Error-proofing / poka-yoke devices functioning", type: "passFailNA", triggersActionOnFail: true },
            { id: "fifo", label: "Material handled FIFO; correct part numbers staged", type: "passFailNA" },
            { id: "prior_actions", label: "Previous audit actions closed out", type: "passFailNA", triggersActionOnFail: true },
          ],
        },
        {
          id: "signoff",
          title: "Findings & sign-off",
          questions: [
            { id: "nonconformance", label: "Non-conformance details", type: "text" },
            { id: "signature", label: "Auditor signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "manufacturing.quality_line_audit",
      name: "Quality / In-Process Line Audit",
      category: "Quality control",
      industry: "manufacturing",
      description: "Capture in-process measurements against tolerance and log defects on the production line.",
      scoringEnabled: true,
      sections: [
        {
          id: "context",
          title: "Job & part",
          questions: [
            { id: "asset", label: "Scan line / machine QR", type: "assetScan", required: true },
            { id: "part_number", label: "Part number", type: "text", required: true },
            { id: "work_order", label: "Work order / batch", type: "text", required: true },
            { id: "inspector", label: "Inspector name", type: "text", required: true },
          ],
        },
        {
          id: "measurements",
          title: "Measurements vs tolerance",
          description: "Record measured values. Readings outside the tolerance band are flagged and raise an action.",
          questions: [
            { id: "length", label: "Length measurement", type: "number", required: true, unit: "mm", min: 99.5, max: 100.5, triggersActionOnFail: true, helpText: "Nominal 100.0 mm ±0.5 mm." },
            { id: "diameter", label: "Bore diameter", type: "number", required: true, unit: "mm", min: 24.95, max: 25.05, triggersActionOnFail: true, helpText: "Nominal 25.00 mm ±0.05 mm." },
            { id: "weight", label: "Unit weight", type: "number", unit: "g", min: 480, max: 520, triggersActionOnFail: true },
            { id: "surface_finish", label: "Surface finish (Ra)", type: "number", unit: "µm", min: 0, max: 1.6, triggersActionOnFail: true },
            { id: "visual_ok", label: "Visual inspection pass (no scratches, flash, contamination)", type: "passFailNA", required: true, triggersActionOnFail: true },
          ],
        },
        {
          id: "defects",
          title: "Defect logging & disposition",
          questions: [
            { id: "defect_found", label: "Defect found?", type: "passFailNA", required: true },
            { id: "defect_type", label: "Defect type", type: "multipleChoice", visibleWhen: { questionId: "defect_found", equals: "fail" }, options: [{ label: "Dimensional", flag: true }, { label: "Surface / cosmetic", flag: true }, { label: "Assembly", flag: true }, { label: "Material", flag: true }, { label: "Contamination", flag: true }] },
            { id: "defect_qty", label: "Quantity defective", type: "number", min: 0, visibleWhen: { questionId: "defect_found", equals: "fail" } },
            { id: "disposition", label: "Disposition", type: "multipleChoice", visibleWhen: { questionId: "defect_found", equals: "fail" }, options: [{ label: "Rework" }, { label: "Scrap", flag: true }, { label: "Use as-is (concession)", flag: true }, { label: "Quarantine / hold", flag: true }] },
            { id: "defect_photo", label: "Photo of defect", type: "photo", visibleWhen: { questionId: "defect_found", equals: "fail" } },
            { id: "inspector_sig", label: "Inspector signature", type: "signature", required: true },
          ],
        },
      ],
    },
  ],
};

export default manufacturingPack;
