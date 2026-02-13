const EPSILON = 1e-9;

export function planReceiptConsumption({
  receipts,
  requestedQuantity,
  stagedRemainingByReceiptId,
  plannedDeductionsByReceiptId,
}) {
  let remaining = Number(requestedQuantity);
  let lineCost = 0;

  for (const receipt of receipts) {
    if (remaining <= EPSILON) break;

    const receiptId = receipt._id.toString();
    const available = stagedRemainingByReceiptId.has(receiptId)
      ? stagedRemainingByReceiptId.get(receiptId)
      : Number(receipt.remainingQuantity || 0);

    if (available <= EPSILON) continue;

    const useQty = Math.min(available, remaining);
    stagedRemainingByReceiptId.set(receiptId, available - useQty);
    remaining -= useQty;
    lineCost += useQty * Number(receipt.unitCost || 0);

    const existing = plannedDeductionsByReceiptId.get(receiptId);
    if (existing) {
      existing.quantity += useQty;
    } else {
      plannedDeductionsByReceiptId.set(receiptId, {
        receiptId: receipt._id,
        quantity: useQty,
      });
    }
  }

  return { remaining, lineCost };
}

export async function applyStockDeductions({ stockReceiptModel, plannedDeductionsByReceiptId }) {
  const appliedDeductions = [];

  try {
    for (const deduction of plannedDeductionsByReceiptId.values()) {
      const quantity = Number(deduction.quantity || 0);
      if (quantity <= EPSILON) continue;

      const updated = await stockReceiptModel.findOneAndUpdate(
        {
          _id: deduction.receiptId,
          remainingQuantity: { $gte: quantity },
        },
        {
          $inc: { remainingQuantity: -quantity },
        },
        { new: true }
      );

      if (!updated) {
        const err = new Error("Stock changed while processing request. Please retry.");
        err.status = 409;
        throw err;
      }

      appliedDeductions.push({
        receiptId: deduction.receiptId,
        quantity,
      });
    }
  } catch (err) {
    await rollbackStockDeductions({
      stockReceiptModel,
      appliedDeductions,
    });
    throw err;
  }

  return appliedDeductions;
}

export async function rollbackStockDeductions({ stockReceiptModel, appliedDeductions }) {
  if (!Array.isArray(appliedDeductions) || appliedDeductions.length === 0) return;

  await stockReceiptModel.bulkWrite(
    appliedDeductions.map((deduction) => ({
      updateOne: {
        filter: { _id: deduction.receiptId },
        update: { $inc: { remainingQuantity: deduction.quantity } },
      },
    }))
  );
}
