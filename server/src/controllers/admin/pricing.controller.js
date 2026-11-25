import GlobalConfig from "../../models/GlobalConfig.js";
import { DEFAULT_WEIGHTS } from "../../modules/pricing/pricing.service.js";

export const getPricingConfig = async (req, res, next) => {
  try {
    let config = await GlobalConfig.findOne({ key: "pricing_config" });
    const value = config?.value || {
      weights: DEFAULT_WEIGHTS,
      useML: false,
      margin: 0.1,
    };
    // Ensure canonical weights exist
    value.weights = { ...DEFAULT_WEIGHTS, ...(value.weights || {}) };
    res.json({ status: "success", data: value });
  } catch (err) {
    next(err);
  }
};

export const updatePricingConfig = async (req, res, next) => {
  try {
    const { weights, useML, margin } = req.body;
    const config = await GlobalConfig.findOneAndUpdate(
      { key: "pricing_config" },
      { value: { weights, useML, margin } },
      { upsert: true, new: true }
    );
    res.json({ status: "success", data: config.value });
  } catch (err) {
    next(err);
  }
};
