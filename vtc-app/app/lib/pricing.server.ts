export type PricingBehavior = "normal_prices" | "all_quote" | "lead_time_pricing";

export type TenantVehicle = {
  id: string;
  label: string;
  baseFare: number;
  pricePerKm: number;
  quoteOnly: boolean;
  imageUrl?: string | null;
};

export type TenantOption = {
  id: string;
  label: string;
  type: "fixed" | "percent";
  amount: number;
};

export type TenantPricingConfig = {
  stopFee: number;
  quoteMessage: string;
  pricingBehavior: PricingBehavior;
  leadTimeThresholdMinutes: number;
  immediateSurchargeEnabled: boolean;
  immediateBaseDeltaAmount: number;
  immediateBaseDeltaPercent: number;
  immediateTotalDeltaPercent: number;
  vehicles: TenantVehicle[];
  options: TenantOption[];
};

export type LeadTimeInfo = {
  mode: "immediate" | "reservation";
  thresholdMinutes: number;
  deltaMinutes: number | null;
};

function parsePickupDateTime(pickupDate: string, pickupTime: string) {
  const date = String(pickupDate || "").trim();
  if (!date) return null;
  const time = String(pickupTime || "").trim() || "00:00";
  const dt = new Date(`${date}T${time}`);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

export function getLeadTimeInfo(config: TenantPricingConfig, input: { pickupDate: string; pickupTime: string }): LeadTimeInfo {
  const thresholdMinutes = Math.max(0, Number(config.leadTimeThresholdMinutes || 0));
  const pickupDateTime = parsePickupDateTime(input.pickupDate, input.pickupTime);
  if (!pickupDateTime) {
    return { mode: "reservation", thresholdMinutes, deltaMinutes: null };
  }

  const now = new Date();
  const deltaMinutes = (pickupDateTime.getTime() - now.getTime()) / 60000;
  if (!Number.isFinite(deltaMinutes)) {
    return { mode: "reservation", thresholdMinutes, deltaMinutes: null };
  }

  return {
    mode: deltaMinutes < thresholdMinutes ? "immediate" : "reservation",
    thresholdMinutes,
    deltaMinutes,
  };
}

export type AppliedOption = {
  id: string;
  label: string;
  type: "fixed" | "percent";
  amount: number;
  fee: number;
};

export type TariffResult =
  | {
      ok: true;
      isQuote: false;
      vehicleId: string;
      vehicleLabel: string;
      total: number;
      pricingMode: "immediate" | "reservation" | null;
      leadTimeThresholdMinutes: number | null;
      surchargesApplied: unknown | null;
      appliedOptions: AppliedOption[];
      optionsFee: number;
      extraStopsTotal: number;
      stopFee: number;
    }
  | {
      ok: true;
      isQuote: true;
      vehicleId: string;
      vehicleLabel: string;
      total: 0;
      quoteMessage: string;
      pricingMode: "all_quote" | null;
    }
  | { ok: false; error: "UNKNOWN_VEHICLE" | "INVALID_INPUT" };

function computeOptions(config: TenantPricingConfig, baseTotal: number, selectedOptionIds: string[]) {
  const selected = new Set(selectedOptionIds.map((id) => String(id || "").trim()).filter(Boolean));
  const base = Number.isFinite(baseTotal) ? baseTotal : 0;

  const applied: AppliedOption[] = [];
  for (const option of config.options || []) {
    if (!selected.has(option.id)) continue;
    const type = option.type === "percent" ? "percent" : "fixed";
    const amount = Number.isFinite(option.amount) ? option.amount : 0;
    const fee = type === "percent" ? base * (amount / 100) : amount;
    applied.push({ id: option.id, label: option.label, type, amount, fee });
  }

  const totalFee = applied.reduce((sum, o) => sum + (Number.isFinite(o.fee) ? o.fee : 0), 0);
  return { applied, totalFee };
}

export function computeTariffForVehicle(config: TenantPricingConfig, input: {
  km: number;
  stopsCount: number;
  pickupDate: string;
  pickupTime: string;
  vehicleId: string;
  selectedOptionIds: string[];
}): TariffResult {
  const km = Number(input.km);
  const stopsCount = Math.max(0, Number(input.stopsCount || 0));
  if (!Number.isFinite(km) || km < 0) return { ok: false, error: "INVALID_INPUT" };

  const vehicleId = String(input.vehicleId || "").trim();
  const vehicle = (config.vehicles || []).find((v) => v.id === vehicleId) || null;
  if (!vehicle) return { ok: false, error: "UNKNOWN_VEHICLE" };

  const extraStopsTotal = stopsCount * (Number(config.stopFee) || 0);

  if (config.pricingBehavior === "all_quote" || vehicle.quoteOnly || vehicle.id === "autre") {
    return {
      ok: true,
      isQuote: true,
      vehicleId: vehicle.id,
      vehicleLabel: vehicle.label,
      total: 0,
      quoteMessage: String(config.quoteMessage || "Sur devis").trim(),
      pricingMode: config.pricingBehavior === "all_quote" ? "all_quote" : null,
    };
  }

  // Billing rule: base fare + per-km from the 1st km.
  // 0–1 km counts as 1 km. We round up so 12.2 km => 13 km billed.
  const billableKm = Math.max(1, Math.ceil(km));
  let total = (Number(vehicle.baseFare) || 0) + billableKm * (Number(vehicle.pricePerKm) || 0);
  total += extraStopsTotal;

  // Majoration nuit 22h–05h
  if (input.pickupTime) {
    const hour = parseInt(String(input.pickupTime).split(":")[0] || "", 10);
    if (Number.isFinite(hour) && (hour >= 22 || hour < 5)) total *= 1.1;
  }

  // Remise si > 600 €
  if (total > 600) total *= 0.9;

  // baseFare is always included (no minimum rule needed)

  const optionsPricing = computeOptions(config, total, input.selectedOptionIds || []);
  total += optionsPricing.totalFee;

  let pricingMode: "immediate" | "reservation" | null = null;
  let surchargesApplied: unknown | null = null;
  let leadTimeThresholdMinutes: number | null = null;

  if (config.pricingBehavior === "lead_time_pricing") {
    const lead = getLeadTimeInfo(config, { pickupDate: input.pickupDate, pickupTime: input.pickupTime });
    pricingMode = lead.mode;
    leadTimeThresholdMinutes = lead.thresholdMinutes;

    if (lead.mode === "immediate" && config.immediateSurchargeEnabled) {
      const base = Number(vehicle.baseFare) || 0;
      const baseDeltaAmount = Math.max(0, Number(config.immediateBaseDeltaAmount || 0));
      const baseDeltaPercent = Math.max(0, Number(config.immediateBaseDeltaPercent || 0));
      const totalDeltaPercent = Math.max(0, Number(config.immediateTotalDeltaPercent || 0));

      const basePercentAmount = base * (baseDeltaPercent / 100);
      total += baseDeltaAmount + basePercentAmount;
      if (totalDeltaPercent > 0) total *= 1 + totalDeltaPercent / 100;

      surchargesApplied = {
        kind: "immediate",
        baseDeltaAmount,
        baseDeltaPercent,
        totalDeltaPercent,
        thresholdMinutes: lead.thresholdMinutes,
        deltaMinutes: lead.deltaMinutes,
      };
    } else {
      surchargesApplied = {
        kind: lead.mode,
        thresholdMinutes: lead.thresholdMinutes,
        deltaMinutes: lead.deltaMinutes,
      };
    }
  }

  return {
    ok: true,
    isQuote: false,
    vehicleId: vehicle.id,
    vehicleLabel: vehicle.label,
    total,
    pricingMode,
    leadTimeThresholdMinutes,
    surchargesApplied,
    appliedOptions: optionsPricing.applied,
    optionsFee: optionsPricing.totalFee,
    extraStopsTotal,
    stopFee: Number(config.stopFee) || 0,
  };
}
