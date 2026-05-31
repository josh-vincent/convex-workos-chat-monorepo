// Construction & Trades template pack (see docs/09-vertical-deep-dive.md §1).
// Beachhead vertical #1. Covers daily safety, plant pre-starts, high-risk permits,
// toolbox talks and incident reporting.
import type { TemplatePack } from "./types";

export const constructionPack: TemplatePack = {
  key: "construction",
  name: "Construction & Trades",
  industry: "construction",
  description:
    "Site safety walks, plant pre-starts, SWMS/JSA, permits-to-work, toolbox talks and incident reporting for mobile, multi-employer worksites.",
  templates: [
    {
      key: "construction.daily_site_safety_walk",
      name: "Daily Site Safety Walk",
      category: "Safety inspection",
      industry: "construction",
      description: "Start-of-day walkthrough of site hazards and controls.",
      scoringEnabled: true,
      sections: [
        {
          id: "site",
          title: "Site & access",
          questions: [
            { id: "site", label: "Select site", type: "siteSelect", required: true },
            { id: "weather", label: "Weather / ground conditions", type: "multipleChoice", options: [{ label: "Clear" }, { label: "Wet", flag: true }, { label: "Hot >35°C", flag: true }, { label: "High wind", flag: true }] },
            { id: "access_clear", label: "Access/egress routes clear and signed", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "perimeter", label: "Perimeter fencing & public protection intact", type: "passFailNA", triggersActionOnFail: true },
          ],
        },
        {
          id: "hazards",
          title: "Hazards & controls",
          questions: [
            { id: "housekeeping", label: "Housekeeping — no trip/slip hazards", type: "passFailNA", triggersActionOnFail: true },
            { id: "edges", label: "Fall-from-height edges protected (rails/covers)", type: "passFailNA", triggersActionOnFail: true },
            { id: "electrical", label: "Electrical leads tagged & off the ground", type: "passFailNA" },
            { id: "ppe", label: "All workers in correct PPE", type: "passFailNA", triggersActionOnFail: true },
            { id: "fire", label: "Fire extinguishers present & in date", type: "passFailNA" },
            { id: "hazard_photo", label: "Photograph any hazard found", type: "photo" },
            { id: "notes", label: "Observations / corrective notes", type: "text" },
          ],
        },
        {
          id: "signoff",
          title: "Sign-off",
          questions: [
            { id: "supervisor", label: "Supervisor name", type: "text", required: true },
            { id: "signature", label: "Signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "construction.forklift_prestart",
      name: "Forklift Pre-Start Check",
      category: "Plant pre-start",
      industry: "construction",
      description: "Daily operator pre-start for forklifts / telehandlers.",
      scoringEnabled: true,
      sections: [
        {
          id: "asset",
          title: "Machine",
          questions: [
            { id: "asset", label: "Scan machine QR", type: "assetScan", required: true },
            { id: "hours", label: "Hour meter reading", type: "number", unit: "hrs", required: true },
          ],
        },
        {
          id: "checks",
          title: "Pre-start checks",
          questions: [
            { id: "tyres", label: "Tyres / wheels condition", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "forks", label: "Forks & mast — no cracks/leaks", type: "passFailNA", triggersActionOnFail: true },
            { id: "hydraulics", label: "Hydraulic hoses — no leaks", type: "passFailNA", triggersActionOnFail: true },
            { id: "brakes", label: "Service & park brake operational", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "horn", label: "Horn, lights & reversing beeper", type: "passFailNA" },
            { id: "seatbelt", label: "Seatbelt functional", type: "passFailNA", triggersActionOnFail: true },
            { id: "fluids", label: "Oil / coolant / fuel levels", type: "passFailNA" },
            { id: "defect_photo", label: "Photo of any defect", type: "photo", visibleWhen: { questionId: "forks", equals: "fail" } },
          ],
        },
        {
          id: "result",
          title: "Result",
          questions: [
            { id: "safe", label: "Machine safe to operate?", type: "multipleChoice", required: true, options: [{ label: "Yes" }, { label: "No — tag out", flag: true }] },
            { id: "operator", label: "Operator signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "construction.swms_jsa",
      name: "SWMS / Job Safety Analysis",
      category: "Risk assessment",
      industry: "construction",
      description: "Step-by-step task hazard analysis with risk rating before high-risk work.",
      scoringEnabled: false,
      sections: [
        {
          id: "task",
          title: "Task details",
          questions: [
            { id: "task_desc", label: "Task / activity", type: "text", required: true },
            { id: "high_risk", label: "High-risk construction work involved?", type: "checkbox", options: [{ label: "Working at heights >2m", flag: true }, { label: "Confined space", flag: true }, { label: "Hot work", flag: true }, { label: "Excavation", flag: true }, { label: "Energised electrical", flag: true }, { label: "Mobile plant", flag: true }] },
            { id: "permit_required", label: "Permit-to-work required for any of the above", type: "passFailNA", helpText: "If yes, attach the relevant permit before starting." },
          ],
        },
        {
          id: "steps",
          title: "Hazard analysis",
          description: "Repeat per job step: hazard, initial risk, controls, residual risk.",
          questions: [
            { id: "step", label: "Job step", type: "text", required: true },
            { id: "hazard", label: "Hazard(s)", type: "text", required: true },
            { id: "initial_risk", label: "Initial risk rating", type: "multipleChoice", required: true, options: [{ label: "Low", score: 1 }, { label: "Medium", score: 2 }, { label: "High", score: 3, flag: true }, { label: "Extreme", score: 4, flag: true }] },
            { id: "controls", label: "Controls (hierarchy of control)", type: "text", required: true },
            { id: "residual_risk", label: "Residual risk after controls", type: "multipleChoice", required: true, options: [{ label: "Low" }, { label: "Medium" }, { label: "High", flag: true }] },
          ],
        },
        {
          id: "signoff",
          title: "Worker sign-on",
          questions: [
            { id: "ppe", label: "Required PPE confirmed", type: "checkbox", options: [{ label: "Hard hat" }, { label: "Hi-vis" }, { label: "Steel caps" }, { label: "Gloves" }, { label: "Eye protection" }, { label: "Harness" }] },
            { id: "worker_name", label: "Worker name", type: "text", required: true },
            { id: "signature", label: "Worker signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "construction.working_at_heights_permit",
      name: "Working at Heights Permit",
      category: "Permit to work",
      industry: "construction",
      description: "Authorisation and controls for work above 2 metres.",
      scoringEnabled: false,
      sections: [
        {
          id: "details",
          title: "Permit details",
          questions: [
            { id: "location", label: "Work location / level", type: "text", required: true },
            { id: "height", label: "Working height", type: "number", unit: "m", required: true, min: 2 },
            { id: "valid_until", label: "Permit valid until", type: "datetime", required: true },
          ],
        },
        {
          id: "controls",
          title: "Controls verification",
          questions: [
            { id: "edge_protection", label: "Edge protection / guardrails installed", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "anchor", label: "Anchor points rated & certified", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "harness", label: "Harness & lanyard inspected (in date)", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "exclusion_zone", label: "Drop-zone barricaded below", type: "passFailNA", triggersActionOnFail: true },
            { id: "rescue_plan", label: "Rescue plan in place", type: "passFailNA", required: true },
            { id: "weather_ok", label: "Weather suitable (wind/rain)", type: "passFailNA" },
          ],
        },
        {
          id: "auth",
          title: "Authorisation",
          questions: [
            { id: "worker_sig", label: "Worker signature", type: "signature", required: true },
            { id: "supervisor_sig", label: "Authorising supervisor signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "construction.toolbox_talk",
      name: "Toolbox Talk Record",
      category: "Briefing",
      industry: "construction",
      description: "Pre-shift safety briefing with attendee acknowledgement.",
      scoringEnabled: false,
      sections: [
        {
          id: "talk",
          title: "Topic",
          questions: [
            { id: "topic", label: "Talk topic", type: "text", required: true },
            { id: "presenter", label: "Presented by", type: "text", required: true },
            { id: "date", label: "Date", type: "date", required: true },
            { id: "key_points", label: "Key points discussed", type: "text", required: true },
            { id: "hazards_today", label: "Specific hazards for today", type: "text" },
          ],
        },
        {
          id: "attendance",
          title: "Attendance",
          questions: [
            { id: "attendees", label: "Number of attendees", type: "number", required: true },
            { id: "attendee_sign", label: "Attendee acknowledgement signature(s)", type: "signature", required: true },
            { id: "photo", label: "Photo of sign-on sheet (optional)", type: "photo" },
          ],
        },
      ],
    },
    {
      key: "construction.incident_near_miss",
      name: "Incident / Near-Miss Report",
      category: "Incident reporting",
      industry: "construction",
      description: "Capture incidents, injuries and near-misses with immediate actions.",
      scoringEnabled: false,
      sections: [
        {
          id: "what",
          title: "What happened",
          questions: [
            { id: "type", label: "Event type", type: "multipleChoice", required: true, options: [{ label: "Near miss" }, { label: "First aid injury", flag: true }, { label: "Medical treatment", flag: true }, { label: "Lost time injury", flag: true }, { label: "Property/plant damage", flag: true }, { label: "Environmental" }] },
            { id: "when", label: "Date & time of event", type: "datetime", required: true },
            { id: "location", label: "Location on site", type: "text", required: true },
            { id: "description", label: "Description of event", type: "text", required: true },
            { id: "photos", label: "Photos of scene", type: "media" },
          ],
        },
        {
          id: "people",
          title: "People & injury",
          questions: [
            { id: "injured", label: "Anyone injured?", type: "passFailNA", required: true },
            { id: "injury_detail", label: "Injury details / body part", type: "text", visibleWhen: { questionId: "injured", equals: "fail" } },
            { id: "first_aid", label: "First aid administered?", type: "passFailNA" },
          ],
        },
        {
          id: "action",
          title: "Immediate action & severity",
          questions: [
            { id: "immediate_action", label: "Immediate action taken", type: "text", required: true, triggersActionOnFail: false },
            { id: "potential_severity", label: "Potential severity", type: "multipleChoice", required: true, options: [{ label: "Low" }, { label: "Medium" }, { label: "High", flag: true }, { label: "Critical", flag: true }] },
            { id: "reporter_sig", label: "Reporter signature", type: "signature", required: true },
          ],
        },
      ],
    },
  ],
};

export default constructionPack;
