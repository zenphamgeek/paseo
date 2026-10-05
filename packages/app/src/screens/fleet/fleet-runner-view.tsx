import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Check, Copy, Cpu, Play, Terminal, Zap } from "lucide-react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type { DispatchTaskPayload, FleetNodeSummary } from "./types";

interface FleetRunnerViewProps {
  nodes: FleetNodeSummary[];
  onDispatchTask: (payload: DispatchTaskPayload) => Promise<{ output?: string }>;
}

interface NodePillButtonProps {
  id: string;
  label?: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function NodePillButton({ id, label, isSelected, onSelect }: NodePillButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <Pressable onPress={handlePress} style={[styles.nodePill, isSelected && styles.nodePillActive]}>
      <Text style={[styles.nodePillText, isSelected && styles.nodePillTextActive]}>
        {label ?? id}
      </Text>
    </Pressable>
  );
}

export function FleetRunnerView({ nodes, onDispatchTask }: FleetRunnerViewProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedNode, setSelectedNode] = useState<string>("auto");
  const [selectedTier, setSelectedTier] = useState<"ultra" | "pro">("ultra");
  const [isExecuting, setIsExecuting] = useState(false);
  const [resultOutput, setResultOutput] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectAuto = useCallback(() => setSelectedNode("auto"), []);
  const handleSelectTierUltra = useCallback(() => setSelectedTier("ultra"), []);
  const handleSelectTierPro = useCallback(() => setSelectedTier("pro"), []);
  const handleSelectNode = useCallback((id: string) => setSelectedNode(id), []);

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || isExecuting) return;
    setIsExecuting(true);
    setError(null);
    setResultOutput(null);

    try {
      const res = await onDispatchTask({
        prompt,
        targetNode: selectedNode === "auto" ? undefined : selectedNode,
        tier: selectedTier,
      });
      setResultOutput(res.output || "Task completed successfully with no output returned.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsExecuting(false);
    }
  }, [prompt, isExecuting, onDispatchTask, selectedNode, selectedTier]);

  const handleCopy = useCallback(() => {
    if (!resultOutput) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(resultOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [resultOutput]);

  return (
    <View style={styles.container}>
      {/* Dispatch Control Box */}
      <View style={styles.formCard}>
        <View style={styles.headerRow}>
          <Terminal size={20} color="#20E9C3" />
          <View>
            <Text style={styles.title}>Fleet Swarm Prompt Runner</Text>
            <Text style={styles.subtitle}>
              Dispatch tasks to AGY Fleet nodes with automatic load balancing & quota optimization
            </Text>
          </View>
        </View>

        {/* Options Row */}
        <View style={styles.optionsRow}>
          {/* Target Node Selector */}
          <View style={styles.optionCol}>
            <Text style={styles.optionLabel}>TARGET WORKER NODE</Text>
            <View style={styles.pillsRow}>
              <Pressable
                onPress={handleSelectAuto}
                style={[styles.nodePill, selectedNode === "auto" && styles.nodePillActive]}
              >
                <Text
                  style={[
                    styles.nodePillText,
                    selectedNode === "auto" && styles.nodePillTextActive,
                  ]}
                >
                  ⚡ Auto (9Router)
                </Text>
              </Pressable>

              {nodes.slice(0, 5).map((node) => (
                <NodePillButton
                  key={node.id}
                  id={node.id}
                  isSelected={selectedNode === node.id}
                  onSelect={handleSelectNode}
                />
              ))}
            </View>
          </View>

          {/* Model Tier Selector */}
          <View style={styles.optionCol}>
            <Text style={styles.optionLabel}>MODEL TIER</Text>
            <View style={styles.pillsRow}>
              <Pressable
                onPress={handleSelectTierUltra}
                style={[styles.tierPill, selectedTier === "ultra" && styles.tierPillActiveUltra]}
              >
                <Zap size={12} color={selectedTier === "ultra" ? "#c084fc" : "#64748b"} />
                <Text
                  style={[
                    styles.tierPillText,
                    selectedTier === "ultra" && styles.tierPillTextActiveUltra,
                  ]}
                >
                  Ultra (Opus 4.6/5.5)
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSelectTierPro}
                style={[styles.tierPill, selectedTier === "pro" && styles.tierPillActivePro]}
              >
                <Cpu size={12} color={selectedTier === "pro" ? "#38bdf8" : "#64748b"} />
                <Text
                  style={[
                    styles.tierPillText,
                    selectedTier === "pro" && styles.tierPillTextActivePro,
                  ]}
                >
                  Pro (Gemini 3.8)
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Prompt Input */}
        <View style={styles.inputContainer}>
          <TextInput
            multiline
            numberOfLines={5}
            initialValue={prompt}
            onChangeText={setPrompt}
            placeholder="Enter instructions, architectural requirements, or code refactor request..."
            placeholderTextColor="#64748b"
            style={styles.textArea}
          />
        </View>

        {/* Action Button */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleRun}
            disabled={isExecuting || !prompt.trim()}
            style={[styles.runBtn, (!prompt.trim() || isExecuting) && styles.runBtnDisabled]}
          >
            <Play size={14} color="#071225" />
            <Text style={styles.runBtnText}>
              {isExecuting ? "Executing across Swarm..." : "Dispatch Swarm Task"}
            </Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>Error: {error}</Text> : null}
      </View>

      {/* Execution Output Card */}
      {resultOutput ? (
        <View style={styles.outputCard}>
          <View style={styles.outputHeader}>
            <View style={styles.outputStatusBox}>
              <View style={styles.statusDotGreen} />
              <Text style={styles.outputTitle}>Execution Result</Text>
            </View>

            <Pressable onPress={handleCopy} style={styles.copyBtn}>
              {copied ? <Check size={14} color="#20E9C3" /> : <Copy size={14} color="#94a3b8" />}
              <Text style={styles.copyBtnText}>{copied ? "Copied" : "Copy Output"}</Text>
            </Pressable>
          </View>

          <View style={styles.outputBox}>
            <Text style={styles.outputText}>{resultOutput}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 16,
  },
  formCard: {
    backgroundColor: "#0c182c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 18,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748b",
    fontSize: 12,
  },
  optionsRow: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 12,
  },
  optionCol: {
    gap: 6,
  },
  optionLabel: {
    fontSize: 10,
    color: "#64748b",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  nodePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#071225",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  nodePillActive: {
    backgroundColor: "rgba(32, 233, 195, 0.15)",
    borderColor: "#20E9C3",
  },
  nodePillText: {
    fontSize: 11,
    color: "#94a3b8",
    fontFamily: "monospace",
  },
  nodePillTextActive: {
    color: "#20E9C3",
    fontWeight: "700",
  },
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#071225",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  tierPillActiveUltra: {
    backgroundColor: "rgba(168, 85, 247, 0.15)",
    borderColor: "#a855f7",
  },
  tierPillActivePro: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: "#38bdf8",
  },
  tierPillText: {
    fontSize: 11,
    color: "#94a3b8",
  },
  tierPillTextActiveUltra: {
    color: "#c084fc",
    fontWeight: "700",
  },
  tierPillTextActivePro: {
    color: "#38bdf8",
    fontWeight: "700",
  },
  inputContainer: {
    backgroundColor: "#071225",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 10,
  },
  textArea: {
    color: "#f8fafc",
    fontSize: 13,
    minHeight: 100,
    textAlignVertical: "top",
    fontFamily: "monospace",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  runBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#20E9C3",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  runBtnDisabled: {
    opacity: 0.5,
  },
  runBtnText: {
    color: "#071225",
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 12,
  },
  outputCard: {
    backgroundColor: "#0c182c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 16,
    gap: 12,
  },
  outputHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  outputStatusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#20E9C3",
    boxShadow: "0 0 6px #20E9C3",
  },
  outputTitle: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: "#071225",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  copyBtnText: {
    color: "#94a3b8",
    fontSize: 11,
  },
  outputBox: {
    backgroundColor: "#071225",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    padding: 12,
    maxHeight: 350,
  },
  outputText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 18,
  },
});
