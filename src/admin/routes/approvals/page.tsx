import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Button, Container, Heading, Text, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";
import {
  AnalysisRun,
  AnalysisTimeline,
  StateBadge,
} from "../../components/analysis-timeline";

type Request = {
  id: string;
  company_name: string;
  customer_id: string;
  cart_id: string;
  amount_minor: number;
  limit_minor: number;
  currency_code: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  reason: string | null;
  current_run_id: string | null;
  decision_run_id: string | null;
  analysis_status: string;
  recommendation: string | null;
  snapshot: {
    items: { title: string; quantity: number; unit_price: number }[];
  };
};
const money = (minor: number, currency = "pln") =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    minor / 100,
  );
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.message || `Request failed (${response.status})`);
  return body;
}
const ApprovalPage = () => {
  const [requests, setRequests] = useState<Request[]>([]);
  const [status, setStatus] = useState("pending");
  const [offset, setOffset] = useState(0);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Request | null>(null);
  const [budget, setBudget] = useState<{ used: number; limit: number } | null>(null);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true,
      pending = false;
    setLoading(true);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await api(
          `/admin/approval-requests?offset=${offset}${status ? `&status=${status}` : ""}`,
        );
        if (active) {
          setRequests(data.approval_requests);
          setCount(data.count);
          setError("");
        }
      } catch (e: any) {
        if (active) setError(e.message);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [status, offset, revision]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setRuns([]);
      return;
    }
    let active = true,
      pending = false;
    setDetail(null);
    setRuns([]);
    setReason("");
    setViewRunId(null);
    setDetailError("");
    setDetailLoading(true);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await api(`/admin/approval-requests/${selected}`);
        if (active) {
          setDetail(data.approval_request);
          setRuns(data.analysis_runs);
          setBudget(data.agent_budget);
          setDetailError("");
        }
      } catch (e: any) {
        if (active) setDetailError(e.message);
      } finally {
        pending = false;
        if (active) setDetailLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected]);

  async function action(decision?: "approved" | "rejected") {
    if (!detail || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const data = await api(
        `/admin/approval-requests/${detail.id}/${decision ? "decision" : "analysis/retry"}`,
        {
          method: "POST",
          body: JSON.stringify(decision ? { decision, reason } : {}),
        },
      );
      setDetail(data.approval_request);
      setViewRunId(null);
      setNotice(
        decision
          ? `Human decision: ${decision}. No order or payment was created.`
          : "New analysis queued. The previous run remains in the history.",
      );
      setRevision((value) => value + 1);
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setSaving(false);
    }
  }
  const currentRun = runs.find((run) => run.id === detail?.current_run_id);
  const viewedRun = runs.find((run) => run.id === viewRunId) || currentRun;
  const viewingHistory = Boolean(
    viewedRun && viewedRun.id !== detail?.current_run_id,
  );
  const ready =
    !viewingHistory &&
    Boolean(
      detail?.current_run_id &&
        ["completed", "error"].includes(detail.analysis_status),
    );
  const blockers = [...(currentRun?.input.facts.blockers || []), ...(currentRun?.violations || []).filter(v => ["identity_invalid", "company_access_denied", "cart_invalid", "preflight_unavailable"].includes(v.code)).map(v => v.code)];

  return (
    <div className="flex flex-col gap-6">
      <Container className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Text size="small" className="text-ui-fg-muted">
              RIGBY PORTFOLIO / HUMAN-IN-THE-LOOP
            </Text>
            <Heading level="h1">AI-Assisted B2B Order Approval</Heading>
            <Text className="mt-2 text-ui-fg-subtle">
              Policy → Risk → Recommendation → Human decision
            </Text>
          </div>
          <Button
            variant="secondary"
            onClick={() => setRevision((v) => v + 1)}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
        <div className="mt-5 rounded-lg border p-3 text-sm text-ui-fg-subtle">
          Agents provide evidence and advice. Only an authorized human can
          decide. Approval applies to the saved cart snapshot; it does not place
          an order or collect payment.
        </div>
        <div
          className="mt-5 flex flex-wrap gap-2"
          aria-label="Filter by status"
        >
          {["pending", "approved", "rejected", ""].map((value) => (
            <Button
              key={value}
              variant={status === value ? "primary" : "secondary"}
              onClick={() => {
                setStatus(value);
                setOffset(0);
              }}
            >
              {value || "All"}
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-ui-fg-error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status" className="py-8">
            Loading requests…
          </p>
        ) : (
          !error && (
            <>
              <div className="overflow-x-auto">
                <table className="mt-5 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-ui-fg-subtle">
                      <th className="py-3">Company / request</th>
                      <th>Purchase</th>
                      <th>Agent analysis</th>
                      <th>Human decision</th>
                      <th>
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((request) => (
                      <tr key={request.id} className="border-b">
                        <td className="py-4">
                          <p className="font-medium">{request.company_name}</p>
                          <p className="text-xs text-ui-fg-muted">
                            {request.id}
                          </p>
                        </td>
                        <td>
                          {money(request.amount_minor, request.currency_code)}
                          <p className="text-xs text-ui-fg-muted">
                            Limit{" "}
                            {money(request.limit_minor, request.currency_code)}
                          </p>
                        </td>
                        <td>
                          {request.current_run_id ? (
                            <>
                              <StateBadge status={request.analysis_status} />
                              <p className="mt-1 text-xs">
                                {request.recommendation?.replaceAll("_", " ") ||
                                  "No recommendation yet"}
                              </p>
                            </>
                          ) : (
                            "Legacy · no run"
                          )}
                        </td>
                        <td>
                          <StateBadge status={request.status} />
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            disabled={saving}
                            onClick={() => {
                              setSelected(request.id);
                              setNotice("");
                            }}
                          >
                            Review
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!requests.length && (
                <div className="py-8 text-center">
                  <Heading level="h2">No {status} requests</Heading>
                  <Text>Submit a scenario at /demo to begin.</Text>
                </div>
              )}
              <div className="mt-4 flex items-center justify-between">
                <Text size="small">
                  {count} requests · {requests.length ? offset + 1 : 0}–
                  {offset + requests.length}
                </Text>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={offset + 20 >= count}
                    onClick={() => setOffset(offset + 20)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )
        )}
      </Container>
      {selected && (
        <Container className="p-6">
          <Heading level="h2">Purchase & agent timeline</Heading>
          {detailLoading && (
            <p role="status">Loading purchase and persisted analysis…</p>
          )}
          {detailError && (
            <p role="alert" className="mt-3 text-ui-fg-error">
              {detailError}
            </p>
          )}
          {detail && (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Heading level="h2">
                    {detail.company_name} ·{" "}
                    {money(detail.amount_minor, detail.currency_code)}
                  </Heading>
                  <p className="mt-1 text-xs text-ui-fg-muted">{detail.id}</p>
                </div>
                <StateBadge status={detail.status} />
              </div>
              <details className="my-5 rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Saved purchase snapshot
                </summary>
                <p className="mt-3 text-sm">
                  Limit at submission:{" "}
                  {money(detail.limit_minor, detail.currency_code)}
                </p>
                <p className="break-all text-xs text-ui-fg-muted">
                  Cart: {detail.cart_id} · Customer: {detail.customer_id}
                </p>
                {detail.snapshot.items.map((item, index) => (
                  <p key={index} className="mt-2 text-sm">
                    {item.quantity} × {item.title} ·{" "}
                    {money(
                      item.unit_price * item.quantity * 100,
                      detail.currency_code,
                    )}
                  </p>
                ))}
              </details>
              {runs.length > 1 && (
                <div className="mb-4">
                  <label htmlFor="analysis-run" className="mr-3 text-sm">
                    Analysis history
                  </label>
                  <select
                    id="analysis-run"
                    className="rounded border bg-ui-bg-base p-2 text-sm"
                    value={viewedRun?.id || ""}
                    onChange={(event) => setViewRunId(event.target.value)}
                  >
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        Run #{run.sequence} · {run.provider} · {run.status}
                        {run.id === detail.current_run_id
                          ? " (current)"
                          : " (historical)"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {budget && <p className="my-3 text-sm">Provider call budget: {budget.used}/{budget.limit} used across all runs. Maximum 2 attempts per stage, 3 runs per request. Failed and interrupted attempts count.</p>}
            {viewedRun ? (
                <AnalysisTimeline run={viewedRun} />
              ) : (
                <p className="my-4 text-sm">
                  This legacy request has no agent analysis.
                </p>
              )}
              {notice && (
                <p role="status" className="my-4 rounded border p-3 text-sm">
                  {notice}
                </p>
              )}
              {detail.status === "pending" ? (
                <div className="mt-6 border-t pt-5">
                  <Heading level="h2">Human decision</Heading>
                  {viewingHistory && (
                    <p className="my-3 text-sm text-ui-fg-subtle">
                      Viewing a historical run. Select the current analysis
                      before making a decision.
                    </p>
                  )}
                  {!ready && !viewingHistory && (
                    <p className="my-3 text-sm text-ui-fg-subtle">
                      Wait for the analysis to complete or fail. The server also
                      enforces this rule.
                    </p>
                  )}
                  {detail.analysis_status === "error" && (
                    <div className="my-3 rounded border p-3 text-sm">
                      <p>
                        Agent analysis failed. Inspect the available evidence
                        and review manually, or retry. No automatic approval is
                        possible.
                      </p>
                      <Button
                        className="mt-3"
                        variant="secondary"
                        disabled={saving || runs.length >= 3}
                        onClick={() => action()}
                      >
                        Retry analysis
                      </Button>
                      <p className="mt-2 text-xs">
                        Maximum 3 runs; previous results remain visible.
                      </p>
                    </div>
                  )}
                  {!detail.current_run_id && (
                    <Button
                      className="my-3"
                      variant="secondary"
                      onClick={() => action()}
                      disabled={saving}
                    >
                      Start analysis
                    </Button>
                  )}
                  {blockers.length > 0 && (
                    <p className="my-3 text-sm text-ui-fg-error">
                      Approval blocked by code: {blockers.join(", ")}. Submit a
                      corrected purchase; an AI suggestion cannot bypass this.
                    </p>
                  )}
                  <label
                    htmlFor="reason"
                    className="mt-3 block text-sm font-medium"
                  >
                    Decision reason (required)
                  </label>
                  <Textarea
                    id="reason"
                    className="mt-2"
                    value={reason}
                    maxLength={1000}
                    disabled={saving}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Record your independent business judgment…"
                  />
                  <div className="mt-3 flex gap-3">
                    <Button
                      isLoading={saving}
                      disabled={
                        !ready ||
                        !reason.trim() ||
                        saving ||
                        blockers.length > 0 ||
                        !currentRun
                      }
                      onClick={() => action("approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      disabled={!ready || !reason.trim() || saving}
                      onClick={() => action("rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-lg bg-ui-bg-subtle p-4">
                  <Heading level="h3">Human decision recorded</Heading>
                  <p className="my-2 whitespace-pre-wrap text-sm">
                    {detail.reason}
                  </p>
                  <Text size="small" className="text-ui-fg-muted">
                    {detail.decided_at &&
                      new Date(detail.decided_at).toLocaleString("en-GB")}{" "}
                    · {detail.decided_by}
                  </Text>
                  <p className="mt-2 break-all text-xs text-ui-fg-muted">
                    Reviewed analysis:{" "}
                    {detail.decision_run_id || "Legacy decision"}. No checkout
                    or payment.
                  </p>
                </div>
              )}
            </>
          )}
        </Container>
      )}
    </div>
  );
};
export const config = defineRouteConfig({ label: "AI Order approvals" });
export default ApprovalPage;
