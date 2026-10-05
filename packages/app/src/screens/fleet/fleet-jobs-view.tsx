import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  ListFilter,
  XCircle,
} from "lucide-react-native";
import type { FleetJobRecord } from "./types";

interface FleetJobsViewProps {
  jobs: FleetJobRecord[];
}

interface JobCardItemProps {
  job: FleetJobRecord;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

function JobCardItem({ job, isExpanded, onToggle }: JobCardItemProps) {
  const handlePress = useCallback(() => {
    onToggle(job.id);
  }, [job.id, onToggle]);

  const isSuccess = job.status === "completed";

  return (
    <View style={styles.jobCard}>
      <Pressable onPress={handlePress} style={styles.jobSummaryRow}>
        <View style={styles.jobStatusCol}>
          {isSuccess ? (
            <CheckCircle2 size={16} color={styles.iconAccent.color} />
          ) : (
            <XCircle size={16} color={styles.iconDanger.color} />
          )}
        </View>

        <View style={styles.jobMainCol}>
          <View style={styles.jobMetaRow}>
            <Text style={styles.jobId}>{job.id}</Text>
            <View style={styles.nodeTag}>
              <Cpu size={10} color={styles.iconAccent.color} />
              <Text style={styles.nodeTagText}>{job.nodeId}</Text>
            </View>
            <Text style={styles.modelTag}>{job.model}</Text>
          </View>
          <Text style={styles.jobPrompt} numberOfLines={isExpanded ? undefined : 1}>
            {job.prompt}
          </Text>
        </View>

        <View style={styles.jobStatsCol}>
          <View style={styles.durationRow}>
            <Clock size={11} color={styles.iconMuted.color} />
            <Text style={styles.durationText}>
              {job.durationMs !== undefined ? `${(job.durationMs / 1000).toFixed(1)}s` : "running"}
            </Text>
          </View>
          <Text style={styles.tokensText}>{job.tokensUsed ? `${job.tokensUsed} tok` : "-"}</Text>
        </View>

        <View style={styles.expandIconCol}>
          {isExpanded ? (
            <ChevronDown size={16} color={styles.iconMuted.color} />
          ) : (
            <ChevronRight size={16} color={styles.iconMuted.color} />
          )}
        </View>
      </Pressable>

      {isExpanded && job.outputPreview ? (
        <View style={styles.expandedContent}>
          <Text style={styles.outputHeading}>Output Preview:</Text>
          <View style={styles.outputBox}>
            <Text style={styles.outputText}>{job.outputPreview}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function FleetJobsView({ jobs }: FleetJobsViewProps) {
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedJobId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ListFilter size={18} color={styles.iconAccent.color} />
          <Text style={styles.title}>Execution History & Swarm Flow ({jobs.length})</Text>
        </View>
      </View>

      {jobs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No swarm jobs executed yet</Text>
          <Text style={styles.emptySub}>
            Use the Prompt Runner or launch an Autonomous Goal to dispatch tasks across nodes.
          </Text>
        </View>
      ) : (
        <View style={styles.jobsList}>
          {jobs.map((job) => (
            <JobCardItem
              key={job.id}
              job={job}
              isExpanded={expandedJobId === job.id}
              onToggle={toggleExpand}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    gap: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "700",
  },
  emptyCard: {
    padding: 36,
    borderRadius: 12,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "600",
  },
  emptySub: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    textAlign: "center",
    maxWidth: 400,
  },
  jobsList: {
    gap: 8,
  },
  jobCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  jobSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  jobStatusCol: {
    width: 20,
    alignItems: "center",
  },
  jobMainCol: {
    flex: 1,
    gap: 4,
  },
  jobMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  jobId: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontFamily: "monospace",
  },
  nodeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: theme.colors.accent + "1a",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  nodeTagText: {
    color: theme.colors.accent,
    fontSize: 10,
    fontFamily: "monospace",
  },
  modelTag: {
    color: theme.colors.statusMerged,
    fontSize: 10,
  },
  jobPrompt: {
    color: theme.colors.foreground,
    fontSize: 12,
  },
  jobStatsCol: {
    alignItems: "flex-end",
    gap: 2,
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  durationText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontFamily: "monospace",
  },
  tokensText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  expandIconCol: {
    width: 16,
    alignItems: "center",
  },
  expandedContent: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    padding: 12,
    gap: 6,
  },
  outputHeading: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  outputBox: {
    backgroundColor: theme.colors.surface0,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  outputText: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontFamily: "monospace",
    lineHeight: 16,
  },
  iconAccent: {
    color: theme.colors.accent,
  },
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
  iconDanger: {
    color: theme.colors.destructive,
  },
}));
