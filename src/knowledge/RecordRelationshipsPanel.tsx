import { FC, useState, useEffect, useCallback, KeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  KnowledgeRecordSummary,
  RecordRelationshipsResponse,
  RelationType,
} from "./types";
import { RELATION_TYPES, getRelationMeta } from "./relationshipConstants";
import * as api from "./knowledgeApi";

interface RecordRelationshipsPanelProps {
  recordId: string;
  recordTitle: string;
  onNavigateToRecord: (targetId: string) => void;
  onShowNotice: (msg: string) => void;
}

export const RecordRelationshipsPanel: FC<RecordRelationshipsPanelProps> = ({
  recordId,
  recordTitle,
  onNavigateToRecord,
  onShowNotice,
}) => {
  const [relationships, setRelationships] = useState<RecordRelationshipsResponse>({
    outgoing: [],
    incoming: [],
  });
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

  // Add Modal Form State
  const [candidateRecords, setCandidateRecords] = useState<KnowledgeRecordSummary[]>([]);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState<string>("");
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedRelationType, setSelectedRelationType] = useState<RelationType>("builds_on");
  const [relationshipDescription, setRelationshipDescription] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Load relationships for the current record
  const loadRelationships = useCallback(async () => {
    try {
      const res = await api.getRecordRelationships(recordId);
      setRelationships(res);
    } catch (err) {
      console.error("[RecordRelationshipsPanel] Failed to load relationships:", err);
    }
  }, [recordId]);

  useEffect(() => {
    loadRelationships();
  }, [loadRelationships]);

  // Open inline form and load candidate records
  const handleOpenAddForm = async () => {
    if (isAddModalOpen) {
      setIsAddModalOpen(false);
      return;
    }
    setSelectedTargetId(null);
    setSelectedRelationType("builds_on");
    setRelationshipDescription("");
    setCandidateSearchQuery("");
    setFormError(null);
    setIsAddModalOpen(true);

    try {
      const allRecords = await api.listRecords(undefined, 200, 0);
      // Exclude current record
      const filtered = allRecords.filter((r) => r.id !== recordId);
      setCandidateRecords(filtered);
      if (filtered.length > 0) {
        setSelectedTargetId(filtered[0].id);
      }
    } catch (err) {
      console.error("[RecordRelationshipsPanel] Failed to load candidate records:", err);
      setFormError("Failed to load records for relationship");
    }
  };

  const handleCloseAddForm = () => {
    setIsAddModalOpen(false);
    setFormError(null);
  };

  // Submit new relationship
  const handleCreateRelationship = async () => {
    if (!selectedTargetId) {
      setFormError("Please select a concept to connect to.");
      return;
    }

    if (selectedTargetId === recordId) {
      setFormError("A record cannot be connected to itself.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await api.createRelationship({
        source_id: recordId,
        target_id: selectedTargetId,
        relation_type: selectedRelationType,
        description: relationshipDescription.trim() || null,
      });

      onShowNotice("Relationship saved");
      setIsAddModalOpen(false);
      await loadRelationships();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg || "Failed to create relationship");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete relationship
  const handleDeleteRelationship = async (relId: string, relTitle: string) => {
    if (pendingDeleteId === relId) return;
    setPendingDeleteId(relId);
    try {
      const ok = await api.deleteRelationship(relId);
      onShowNotice(
        ok
          ? `Removed connection with '${relTitle}'`
          : "Connection could not be removed — it may already be gone."
      );
      await loadRelationships();
    } catch (err) {
      console.error("[RecordRelationshipsPanel] Failed to delete relationship:", err);
      onShowNotice("Failed to delete relationship");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const totalCount = relationships.outgoing.length + relationships.incoming.length;

  // Filter candidate records by search query
  const filteredCandidates = candidateRecords.filter((r) => {
    const q = candidateSearchQuery.toLowerCase().trim();
    if (!q) return true;
    return r.title.toLowerCase().includes(q) || r.preview.toLowerCase().includes(q);
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && isAddModalOpen) {
      e.stopPropagation();
      handleCloseAddForm();
    }
  };

  return (
    <div className="relationships-panel" onKeyDown={handleKeyDown}>
      {/* Header bar */}
      <div className="relationships-header">
        <button
          type="button"
          className="relationships-toggle-btn"
          onClick={() => setIsExpanded((prev) => !prev)}
          title={isExpanded ? "Collapse connections" : "Expand connections"}
        >
          {isExpanded ? (
            <ChevronDown size={13} strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} strokeWidth={1.6} aria-hidden="true" />
          )}
          <span className="relationships-title">
            Connections
            <span className="relationships-count-badge">{totalCount}</span>
          </span>
        </button>

        <div className="relationships-header-actions">
          <button
            type="button"
            className={`desk-btn ${isAddModalOpen ? "active" : ""}`}
            onClick={handleOpenAddForm}
            title={isAddModalOpen ? "Cancel connecting concept" : "Connect this concept to another record"}
          >
            {isAddModalOpen ? "✕ Cancel" : "+ Connect Concept"}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="relationships-body">
          {/* Inline Add Connection Form */}
          {isAddModalOpen && (
            <div className="relationship-inline-card" role="region" aria-label="Add Connection">
              <div className="relationship-inline-title">
                Connect “{recordTitle || "Active Concept"}”
              </div>

              {formError && <div className="relationship-form-error">{formError}</div>}

              <div className="relationship-form-field">
                <label htmlFor="target-record-search" className="form-label">
                  Target Concept
                </label>
                <input
                  id="target-record-search"
                  type="text"
                  className="relationship-search-input"
                  placeholder="Search concepts to connect…"
                  value={candidateSearchQuery}
                  onChange={(e) => setCandidateSearchQuery(e.target.value)}
                  autoFocus
                />

                <div className="candidate-records-select-container">
                  {filteredCandidates.length === 0 ? (
                    <div className="candidate-empty">No matching concepts found.</div>
                  ) : (
                    filteredCandidates.map((r) => (
                      <div
                        key={r.id}
                        className={`candidate-record-item ${
                          selectedTargetId === r.id ? "selected" : ""
                        }`}
                        onClick={() => setSelectedTargetId(r.id)}
                      >
                        <div className="candidate-title">{r.title || "Untitled Record"}</div>
                        {r.preview && <div className="candidate-preview">{r.preview}</div>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="relationship-form-field">
                <label htmlFor="relation-type-select" className="form-label">
                  Relationship Type
                </label>
                <select
                  id="relation-type-select"
                  className="relationship-type-dropdown"
                  value={selectedRelationType}
                  onChange={(e) => setSelectedRelationType(e.target.value as RelationType)}
                >
                  {RELATION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} ({t.description})
                    </option>
                  ))}
                </select>
              </div>

              <div className="relationship-form-field">
                <label htmlFor="relation-desc-input" className="form-label">
                  Explanation (optional)
                </label>
                <input
                  id="relation-desc-input"
                  type="text"
                  className="relationship-desc-input"
                  placeholder="Why or how do these connect?…"
                  value={relationshipDescription}
                  onChange={(e) => setRelationshipDescription(e.target.value)}
                />
              </div>

              <div className="confirm-actions" style={{ marginTop: "12px" }}>
                <button
                  type="button"
                  className="desk-btn"
                  onClick={handleCloseAddForm}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="desk-btn primary"
                  onClick={handleCreateRelationship}
                  disabled={isSubmitting || !selectedTargetId}
                >
                  {isSubmitting ? "Connecting…" : "Create Connection"}
                </button>
              </div>
            </div>
          )}

          {totalCount === 0 && !isAddModalOpen ? (
            <div className="relationships-empty-state">
              <span className="empty-hint">
                Link related ideas to build a network of knowledge.
              </span>
            </div>
          ) : (
            <div className="relationships-grid">
              {/* Outgoing relationships (This concept connects to ...) */}
              {relationships.outgoing.length > 0 && (
                <div className="relationships-section">
                  <div className="section-label">Connects to ({relationships.outgoing.length})</div>
                  <div className="relationship-items-list">
                    {relationships.outgoing.map((rel) => {
                      const meta = getRelationMeta(rel.relation_type);
                      return (
                        <div key={rel.id} className="relationship-card outgoing">
                          <div className="rel-card-main">
                            <span className="rel-badge" title={meta.description}>
                              {meta.outgoingLabel}
                            </span>
                            <button
                              type="button"
                              className="rel-target-link"
                              onClick={() => onNavigateToRecord(rel.target_id)}
                              title={`Navigate to '${rel.target_title}'`}
                            >
                              {rel.target_title || "Untitled Record"}
                            </button>
                          </div>
                          {rel.description && (
                            <div className="rel-description">{rel.description}</div>
                          )}
                          <div className="rel-actions">
                            <button
                              type="button"
                              className="rel-delete-btn"
                              onClick={() =>
                                handleDeleteRelationship(rel.id, rel.target_title)
                              }
                              disabled={pendingDeleteId === rel.id}
                              title="Delete relationship"
                              aria-label="Delete relationship"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Incoming relationships (Referenced by ...) */}
              {relationships.incoming.length > 0 && (
                <div className="relationships-section">
                  <div className="section-label">Referenced by ({relationships.incoming.length})</div>
                  <div className="relationship-items-list">
                    {relationships.incoming.map((rel) => {
                      const meta = getRelationMeta(rel.relation_type);
                      return (
                        <div key={rel.id} className="relationship-card incoming">
                          <div className="rel-card-main">
                            <span className="rel-badge incoming" title={meta.description}>
                              {meta.incomingLabel}
                            </span>
                            <button
                              type="button"
                              className="rel-target-link"
                              onClick={() => onNavigateToRecord(rel.source_id)}
                              title={`Navigate to '${rel.source_title}'`}
                            >
                              {rel.source_title || "Untitled Record"}
                            </button>
                          </div>
                          {rel.description && (
                            <div className="rel-description">{rel.description}</div>
                          )}
                          <div className="rel-actions">
                            <button
                              type="button"
                              className="rel-delete-btn"
                              onClick={() =>
                                handleDeleteRelationship(rel.id, rel.source_title)
                              }
                              disabled={pendingDeleteId === rel.id}
                              title="Delete relationship"
                              aria-label="Delete relationship"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
