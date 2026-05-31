// Transport, Logistics & Fleet template pack (see docs/09-vertical-deep-dive.md §2).
// Covers vehicle pre-starts (DVIR-style), load restraint, driver fatigue/fitness,
// cold-chain reefer monitoring and depot/yard safety audits for road-transport fleets.
import type { TemplatePack } from "./types";

export const transportPack: TemplatePack = {
  key: "transport",
  name: "Transport, Logistics & Fleet",
  industry: "transport",
  description:
    "Vehicle pre-starts (DVIR), defect reporting that raises work orders, driver fatigue and fitness-for-duty declarations, and cold-chain temperature checks for road-transport, logistics and fleet operations.",
  templates: [
    {
      key: "transport.heavy_vehicle_prestart",
      name: "Heavy Vehicle Pre-Start (DVIR)",
      category: "Vehicle pre-start",
      industry: "transport",
      description: "Driver daily pre-trip inspection for heavy vehicles; defects raise work orders.",
      scoringEnabled: true,
      sections: [
        {
          id: "vehicle",
          title: "Vehicle & identification",
          questions: [
            { id: "vehicle", label: "Scan vehicle QR", type: "assetScan", required: true, helpText: "Binds this inspection to the prime mover / rigid unit." },
            { id: "odometer", label: "Odometer reading", type: "number", unit: "km", required: true },
            { id: "rego", label: "Registration confirmed on vehicle", type: "passFailNA", required: true },
          ],
        },
        {
          id: "exterior",
          title: "Exterior & running gear",
          description: "Walk-around check before start-up.",
          questions: [
            { id: "tyres", label: "Tyres — tread, pressure, no damage", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "wheels", label: "Wheels — nuts/indicators, no studs missing", type: "passFailNA", triggersActionOnFail: true },
            { id: "lights", label: "Headlights, indicators, brake & marker lights", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "mirrors", label: "Mirrors clean, adjusted & undamaged", type: "passFailNA", triggersActionOnFail: true },
            { id: "coupling", label: "Fifth wheel / coupling & safety chains secure", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "fluids", label: "Oil / coolant / fuel / AdBlue levels & no leaks", type: "passFailNA", triggersActionOnFail: true },
            { id: "defect_photo", label: "Photograph any defect found", type: "photo", visibleWhen: { questionId: "tyres", equals: "fail" } },
          ],
        },
        {
          id: "cab",
          title: "Cab & brakes",
          questions: [
            { id: "brakes", label: "Service & park brake operational (air build-up OK)", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "horn", label: "Horn & reversing alarm functional", type: "passFailNA" },
            { id: "wipers", label: "Wipers & washers operational", type: "passFailNA" },
            { id: "seatbelt", label: "Seatbelt & seat in good condition", type: "passFailNA", triggersActionOnFail: true },
          ],
        },
        {
          id: "result",
          title: "Result & sign-off",
          questions: [
            { id: "safe_to_drive", label: "Vehicle safe to drive?", type: "multipleChoice", required: true, options: [{ label: "Yes" }, { label: "No — defect, do not operate", flag: true }] },
            { id: "defect_notes", label: "Defect / corrective notes", type: "text" },
            { id: "driver_sig", label: "Driver signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "transport.load_restraint",
      name: "Trailer / Load Restraint Check",
      category: "Load securing",
      industry: "transport",
      description: "Pre-departure verification of load restraint, weight distribution and placarding.",
      scoringEnabled: true,
      sections: [
        {
          id: "load",
          title: "Load & vehicle",
          questions: [
            { id: "vehicle", label: "Scan trailer / vehicle QR", type: "assetScan", required: true },
            { id: "gross_mass", label: "Gross combination mass", type: "number", unit: "kg", required: true, helpText: "Confirm within the vehicle's rated GCM." },
            { id: "load_type", label: "Load type", type: "multipleChoice", required: true, options: [{ label: "General freight" }, { label: "Palletised" }, { label: "Bulk / loose", flag: true }, { label: "Containerised" }, { label: "Dangerous goods", flag: true }] },
          ],
        },
        {
          id: "restraint",
          title: "Restraint & distribution",
          questions: [
            { id: "restraints_rated", label: "Straps / chains rated for load & in good condition", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "anchor_points", label: "Anchor points / rails undamaged & secure", type: "passFailNA", triggersActionOnFail: true },
            { id: "weight_distribution", label: "Load evenly distributed within axle limits", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "load_secured", label: "Load cannot shift, roll or fall (front/rear/side)", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "dunnage", label: "Dunnage / gates / edge protection fitted as required", type: "passFailNA" },
          ],
        },
        {
          id: "placards",
          title: "Placards & sign-off",
          questions: [
            { id: "placards", label: "Dangerous-goods placards correct & displayed", type: "passFailNA", triggersActionOnFail: true, visibleWhen: { questionId: "load_type", equals: "Dangerous goods" } },
            { id: "load_photo", label: "Photo of secured load", type: "photo" },
            { id: "driver_sig", label: "Driver signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "transport.driver_fatigue_declaration",
      name: "Driver Fatigue & Fitness-for-Duty Declaration",
      category: "Driver declaration",
      industry: "transport",
      description: "Start-of-shift declaration of rest hours, fitness and medication before driving.",
      scoringEnabled: false,
      sections: [
        {
          id: "driver",
          title: "Driver & shift",
          questions: [
            { id: "driver_name", label: "Driver name", type: "text", required: true },
            { id: "shift_start", label: "Shift start date & time", type: "datetime", required: true },
            { id: "planned_hours", label: "Planned driving hours this shift", type: "number", unit: "hrs", required: true },
          ],
        },
        {
          id: "fatigue",
          title: "Rest & fatigue",
          questions: [
            { id: "rest_hours", label: "Continuous rest in the last 24 hours", type: "number", unit: "hrs", required: true, min: 7, helpText: "Below the minimum rest threshold flags for review.", triggersActionOnFail: true },
            { id: "feeling_rested", label: "I feel adequately rested and alert", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "fatigue_signs", label: "Experiencing any signs of fatigue?", type: "multipleChoice", required: true, options: [{ label: "None" }, { label: "Mild — manageable", flag: true }, { label: "Significant — unfit to drive", flag: true }] },
          ],
        },
        {
          id: "fitness",
          title: "Fitness & medication",
          questions: [
            { id: "fit_for_duty", label: "Fit for duty (no illness/injury affecting driving)", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "medication", label: "Taking medication that may impair driving?", type: "passFailNA", helpText: "Includes prescription and over-the-counter drugs with drowsiness warnings.", triggersActionOnFail: true },
            { id: "alcohol_drugs", label: "Free of alcohol & illicit drugs", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "declaration_sig", label: "Driver declaration signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "transport.cold_chain_check",
      name: "Cold-Chain Temperature Check",
      category: "Cold chain",
      industry: "transport",
      description: "Reefer set-point vs actual and product core temperatures with breach action.",
      scoringEnabled: true,
      sections: [
        {
          id: "unit",
          title: "Reefer unit",
          questions: [
            { id: "vehicle", label: "Scan refrigerated unit QR", type: "assetScan", required: true },
            { id: "check_time", label: "Check date & time", type: "datetime", required: true },
            { id: "set_point", label: "Reefer set-point temperature", type: "temperature", unit: "°C", required: true },
            { id: "actual_temp", label: "Reefer display / actual air temperature", type: "temperature", unit: "°C", required: true, min: -25, max: 5, helpText: "Out-of-range air temperature flags a potential breach.", triggersActionOnFail: true },
          ],
        },
        {
          id: "product",
          title: "Product core temperatures",
          description: "Probe representative product; chilled 0–5 °C, frozen at or below -18 °C.",
          questions: [
            { id: "chilled_core", label: "Chilled product core temperature", type: "temperature", unit: "°C", min: 0, max: 5, triggersActionOnFail: true },
            { id: "frozen_core", label: "Frozen product core temperature", type: "temperature", unit: "°C", min: -30, max: -18, triggersActionOnFail: true },
            { id: "door_seals", label: "Door seals intact & doors closing fully", type: "passFailNA", triggersActionOnFail: true },
          ],
        },
        {
          id: "breach",
          title: "Breach response & sign-off",
          questions: [
            { id: "breach_detected", label: "Temperature breach detected?", type: "multipleChoice", required: true, options: [{ label: "No" }, { label: "Yes — product quarantined", flag: true }] },
            { id: "breach_action", label: "Action taken on breach", type: "text", visibleWhen: { questionId: "breach_detected", equals: "Yes — product quarantined" } },
            { id: "temp_photo", label: "Photo of reefer display / probe", type: "photo" },
            { id: "driver_sig", label: "Driver signature", type: "signature", required: true },
          ],
        },
      ],
    },
    {
      key: "transport.depot_audit",
      name: "Depot / Yard Safety Audit",
      category: "Safety inspection",
      industry: "transport",
      description: "Periodic audit of depot housekeeping, racking, pedestrian separation and spill readiness.",
      scoringEnabled: true,
      sections: [
        {
          id: "site",
          title: "Site & housekeeping",
          questions: [
            { id: "site", label: "Select depot / yard", type: "siteSelect", required: true },
            { id: "housekeeping", label: "Yard clear of debris, no trip/slip hazards", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "lighting", label: "Yard lighting adequate & functional", type: "passFailNA", triggersActionOnFail: true },
            { id: "signage", label: "Speed limits & traffic signage in place", type: "passFailNA" },
          ],
        },
        {
          id: "traffic",
          title: "Racking & traffic management",
          questions: [
            { id: "racking", label: "Racking undamaged, loaded within limits", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "pedestrian_separation", label: "Pedestrian / forklift separation maintained (walkways marked)", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "loading_dock", label: "Loading dock plates, chocks & restraints in use", type: "passFailNA", triggersActionOnFail: true },
          ],
        },
        {
          id: "emergency",
          title: "Spill & emergency readiness",
          questions: [
            { id: "spill_kit", label: "Spill kit stocked & accessible", type: "passFailNA", required: true, triggersActionOnFail: true },
            { id: "fire_equipment", label: "Fire extinguishers present & in date", type: "passFailNA", triggersActionOnFail: true },
            { id: "first_aid", label: "First aid station stocked", type: "passFailNA" },
            { id: "hazard_photo", label: "Photograph any issue found", type: "photo" },
            { id: "auditor_sig", label: "Auditor signature", type: "signature", required: true },
          ],
        },
      ],
    },
  ],
};

export default transportPack;
