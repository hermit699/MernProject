import mongoose from "mongoose";
import GlobalConfig from "../../models/GlobalConfig.js";
import AppError from "../../utils/AppError.js";

export const CANONICAL_CONDITIONS = ["new", "like_new", "refurbished", "pre_owned"];

export const DEFAULT_WEIGHTS = {
  new: 1.0,
  like_new: 0.85,
  refurbished: 0.75,
  pre_owned: 0.65,
};

/**
 * Normalizes input condition strings to canonical keys with defensive legacy aliases
 */
export const normalizeCondition = (raw) => {
  const str = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (str === "brand_new" || str === "new") return "new";
  if (str === "like_new") return "like_new";
  if (str === "refurbished" || str === "good") return "refurbished";
  if (str === "pre_owned" || str === "fair" || str === "used") return "pre_owned";
  if (str === "broken") return "broken";
  return str;
};

export const estimateDeviceValue = async (basePrice, condition) => {
  if (typeof basePrice !== "number" || isNaN(basePrice) || basePrice < 0) {
    throw new AppError("Base price must be a valid non-negative number", 400);
  }

  // 0. Load Config from MongoDB if connected, otherwise fallback gracefully
  let config = { weights: DEFAULT_WEIGHTS, margin: 0.1 };
  if (mongoose.connection.readyState === 1) {
    try {
      const configDoc = await GlobalConfig.findOne({ key: "pricing_config" });
      if (configDoc?.value) config = configDoc.value;
    } catch {
      // Graceful fallback to DEFAULT_WEIGHTS
    }
  }

  const weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
  const margin = typeof config.margin === "number" ? config.margin : 0.1;

  // 1. Normalize condition
  const normalized = normalizeCondition(condition);
  const weight = weights[normalized] ?? (normalized === "broken" ? 0.4 : null);

  if (weight === null || weight === undefined) {
    throw new AppError(`Invalid device condition: ${condition} for pricing`, 400);
  }

  // 2. Pure Node.js rule-based calculation
  const estimatedValue = Math.round(basePrice * weight);
  const finalPrice = Math.floor(estimatedValue * (1 - margin));

  return {
    estimatedPrice: finalPrice,
    mlEstimatedPrice: estimatedValue,
    marketValue: estimatedValue,
    condition: normalized,
    weight,
    margin,
    isMLUsed: false,
  };
};

export const getPricingConfigData = async () => {
  let config = { weights: DEFAULT_WEIGHTS, margin: 0.1 };
  if (mongoose.connection.readyState === 1) {
    try {
      const configDoc = await GlobalConfig.findOne({ key: "pricing_config" });
      if (configDoc?.value) config = configDoc.value;
    } catch {
      // Graceful fallback
    }
  }
  return {
    weights: { ...DEFAULT_WEIGHTS, ...config.weights },
    useML: false,
    margin: typeof config.margin === "number" ? config.margin : 0.1,
  };
};

/**
 * GET current pricing configuration (for Admin UI compatibility)
 */
export const getPricingConfig = async () => {
  return await getPricingConfigData();
};
