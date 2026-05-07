/**
 * reporter.js — Write check results to Supabase (service role)
 */

function addMinutesIso(iso, minutes) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + Number(minutes) || 5);
  return d.toISOString();
}

async function insertHistory(sb, monitorId, value, error) {
  const { error: e } = await sb.from("history").insert({
    monitor_id: monitorId,
    value: value ?? null,
    error: error ?? null,
  });
  if (e) throw e;
}

async function reportSuccess(sb, monitor, newValue) {
  const now = new Date().toISOString();
  const oldValue = monitor.last_value;

  await insertHistory(sb, monitor.id, newValue, null);

  if (oldValue !== null && oldValue !== newValue) {
    const alertRow = {
      monitor_id: monitor.id,
      old_value: oldValue,
      new_value: newValue,
      user_id: monitor.user_id,
    };
    const { error: aErr } = await sb.from("alerts").insert(alertRow);
    if (aErr) throw aErr;
  }

  const nextAt = addMinutesIso(now, monitor.interval_minutes);
  const { error: uErr } = await sb
    .from("monitors")
    .update({
      last_value: newValue,
      pending_browser_check: false,
      next_check_at: nextAt,
    })
    .eq("id", monitor.id);
  if (uErr) throw uErr;
}

async function reportError(sb, monitor, errMessage) {
  const now = new Date().toISOString();
  await insertHistory(sb, monitor.id, null, errMessage);
  const nextAt = addMinutesIso(now, monitor.interval_minutes);
  const { error: uErr } = await sb
    .from("monitors")
    .update({
      next_check_at: nextAt,
      pending_browser_check: false,
    })
    .eq("id", monitor.id);
  if (uErr) throw uErr;
}

async function reportBotEscalation(sb, monitor, errMessage) {
  const now = new Date().toISOString();
  await insertHistory(sb, monitor.id, null, errMessage);
  const { error: uErr } = await sb
    .from("monitors")
    .update({
      execution_mode: "extension",
      pending_browser_check: false,
      next_check_at: now,
    })
    .eq("id", monitor.id);
  if (uErr) throw uErr;
}

module.exports = { reportSuccess, reportError, reportBotEscalation };
