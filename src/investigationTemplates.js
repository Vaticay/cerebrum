// Pro-only investigation templates — pre-built research arcs a Pro member
// can start in one tap. Each template is a title, a description, and a
// sequence of starter questions that walk a topic from overview to depth.
// Free users see the cards with a PRO badge; tapping one opens the Pro
// upsell instead of starting the investigation.

export const INVESTIGATION_TEMPLATES = [
  {
    id: "lit-review",
    title: "Literature Review",
    description: "Map what is known, what is contested, and where the gaps are on any topic.",
    icon: "bookOpen",
    starterQuestions: [
      "What is the current state of research on {topic}?",
      "What are the main disagreements or controversies in {topic} research?",
      "What are the biggest unanswered questions about {topic}?",
      "Which recent papers have most influenced the field of {topic}?",
    ],
  },
  {
    id: "drug-mechanism",
    title: "Drug Mechanism",
    description: "Trace a compound from molecular target to clinical effect, with the evidence at each step.",
    icon: "network",
    starterQuestions: [
      "What is the molecular mechanism of action of {topic}?",
      "What preclinical evidence supports {topic}'s mechanism of action?",
      "What are the known off-target effects of {topic}?",
      "How does {topic} compare mechanistically to alternatives in its class?",
    ],
  },
  {
    id: "trial-analysis",
    title: "Clinical Trial Analysis",
    description: "Dissect trial design, endpoints, and whether the results actually support the claims.",
    icon: "chart",
    starterQuestions: [
      "What were the design and primary endpoints of the key clinical trials for {topic}?",
      "Did the trial results for {topic} reach statistical and clinical significance?",
      "What were the main limitations or biases in the {topic} trials?",
      "How do the trial populations for {topic} compare to real-world patients?",
    ],
  },
  {
    id: "methods-compare",
    title: "Methods Comparison",
    description: "Compare experimental or analytical approaches head to head before you commit to one.",
    icon: "gauge",
    starterQuestions: [
      "What are the main methodological approaches used to study {topic}?",
      "What are the strengths and limitations of each method for {topic}?",
      "Which method is considered the gold standard for {topic}, and why?",
      "What newer methods are emerging for studying {topic}?",
    ],
  },
];

/** Fill a template's {topic} placeholder. Returns the starter questions. */
export function templateQuestions(template, topic) {
  const t = String(topic || "this topic").trim() || "this topic";
  return template.starterQuestions.map((q) => q.split("{topic}").join(t));
}
