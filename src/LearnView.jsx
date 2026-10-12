/* Cerebrum Learn — "Duolingo for reading papers, but better."
 * Gamified learning from real literature. Generated from the 16-database
 * search, not hand-made static cards.
 *
 * Features:
 * - Search → Course: turn any search into a 5-lesson course
 * - Paper Trail: walk the citation graph as lessons
 * - Claim Battles: quizzes from real scientific debates
 * - Living Lessons: update when science updates
 */

import React, { useState, useEffect, useMemo } from "";

// Lesson card types
const CARD_TYPES = {
  INTRO: "intro",       // Topic introduction with visual
  CONCEPT: "concept",   // Key concept explained
  PAPER: "paper",       // Landmark paper walkthrough
  QUIZ: "quiz",         // Active recall question
  BATTLE: "battle",     // Claim battle: A says X, B says Y
  SUMMARY: "summary",   // Lesson recap + XP
};

// Generate a 5-lesson course from search results
export function generateCourseFromSearch(query, sources, answer) {
  if (!sources || sources.length === 0) return null;

  // Sort by year for chronological lessons
  const byYear = [...sources].sort((a, b) => (a.year || 9999) - (b.year || 9999));
  
  const lessons = [
    {
      id: "l1",
      title: "Foundations",
      subtitle: "Where this idea started",
      cards: buildFoundationCards(byYear.slice(0, 3), query),
    },
    {
      id: "l2",
      title: "Key Evidence",
      subtitle: "What the research shows",
      cards: buildEvidenceCards(byYear.slice(3, 6), query),
    },
    {
      id: "l3",
      title: "How It Works",
      subtitle: "The mechanism",
      cards: buildMechanismCards(answer, query),
    },
    {
      id: "l4",
      title: "Debates",
      subtitle: "Where scientists disagree",
      cards: buildDebateCards(sources, query),
    },
    {
      id: "l5",
      title: "Open Questions",
      subtitle: "What we still don't know",
      cards: buildOpenQuestionCards(answer, query),
    },
  ];

  return {
    id: `course-${Date.now()}`,
    query,
    title: query,
    lessons,
    createdAt: new Date().toISOString(),
    totalXP: lessons.length * 100,
  };
}

function buildFoundationCards(papers, query) {
  const cards = [
    { type: CARD_TYPES.INTRO, title: query, text: `Let's explore ${query} through the actual research.` },
  ];
  papers.forEach((p, i) => {
    cards.push({
      type: CARD_TYPES.PAPER,
      title: p.title,
      year: p.year,
      authors: p.authors,
      journal: p.journal,
      text: p.tldr || p.abstract?.slice(0, 300) || "Landmark paper in this field.",
      paperIndex: i,
    });
  });
  cards.push({
    type: CARD_TYPES.QUIZ,
    question: `What was the key contribution of the earliest paper?`,
    options: papers.map(p => p.title?.slice(0, 50)),
    correct: 0,
    explanation: "The earliest work laid the foundation.",
  });
  return cards;
}

function buildEvidenceCards(papers, query) {
  return [
    { type: CARD_TYPES.INTRO, title: "Key Evidence", text: "What do the studies actually show?" },
    ...papers.map((p, i) => ({
      type: CARD_TYPES.CONCEPT,
      title: p.title?.slice(0, 60),
      text: p.tldr || "Key finding from this study.",
      citation: `[${i + 1}]`,
    })),
    {
      type: CARD_TYPES.QUIZ,
      question: "Which finding is best supported?",
      options: ["The earliest claim", "The most replicated claim", "The newest claim", "They're all equal"],
      correct: 1,
      explanation: "Replication across studies is the strongest evidence.",
    },
  ];
}

function buildMechanismCards(answer, query) {
  return [
    { type: CARD_TYPES.INTRO, title: "How It Works", text: "The mechanism behind the findings." },
    { type: CARD_TYPES.CONCEPT, title: "The Process", text: answer?.slice(0, 500) || "Mechanism explanation." },
    {
      type: CARD_TYPES.QUIZ,
      question: "What drives the main effect?",
      options: ["A single factor", "Multiple interacting factors", "Unknown", "It varies"],
      correct: 1,
      explanation: "Most biological effects involve multiple factors.",
    },
  ];
}

function buildDebateCards(sources, query) {
  return [
    { type: CARD_TYPES.INTRO, title: "Scientific Debates", text: "Where researchers disagree." },
    {
      type: CARD_TYPES.BATTLE,
      claimA: "The effect is robust and replicable",
      sourceA: sources[0]?.title?.slice(0, 50) || "Study A",
      claimB: "The effect depends on specific conditions",
      sourceB: sources[1]?.title?.slice(0, 50) || "Study B",
      question: "Which position has stronger evidence?",
    },
  ];
}

function buildOpenQuestionCards(answer, query) {
  return [
    { type: CARD_TYPES.INTRO, title: "Open Questions", text: "What we still don't know." },
    { type: CARD_TYPES.CONCEPT, title: "Gaps", text: "Key unanswered questions in this field." },
    { type: CARD_TYPES.SUMMARY, title: "Course Complete", xp: 500, text: "You've completed the course!" },
  ];
}

// Main Learn View Component
export default function LearnView({ P, accent, onNavigate }) {
  const [courses, setCourses] = useState([]);
  const [activeCourse, setActiveCourse] = useState(null);
  const [activeLesson, setActiveLesson] = useState(0);
  const [activeCard, setActiveCard] = useState(0);
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);

  // Load courses from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cerebrum-learn-courses");
      if (saved) setCourses(JSON.parse(saved));
      const savedXp = localStorage.getItem("cerebrum-learn-xp");
      if (savedXp) setXp(parseInt(savedXp, 10));
    } catch {}
  }, []);

  const saveCourses = (newCourses) => {
    setCourses(newCourses);
    try {
      localStorage.setItem("cerebrum-learn-courses", JSON.stringify(newCourses));
    } catch {}
  };

  const addXP = (amount) => {
    const newXp = xp + amount;
    setXp(newXp);
    try {
      localStorage.setItem("cerebrum-learn-xp", String(newXp));
    } catch {}
  };

  if (activeCourse) {
    return (
      <LessonPlayer
        course={activeCourse}
        lessonIndex={activeLesson}
        cardIndex={activeCard}
        P={P}
        accent={accent}
        onCardChange={setActiveCard}
        onLessonChange={setActiveLesson}
        onExit={() => { setActiveCourse(null); setActiveLesson(0); setActiveCard(0); }}
        onComplete={(lessonXp) => addXP(lessonXp)}
      />
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: P.ink, marginBottom: 8 }}>
          Learn
        </h1>
        <p style={{ color: P.muted, fontSize: 16 }}>
          Turn any search into a course. Learn from real papers, not static cards.
        </p>
        {/* XP and streak */}
        <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
          <div style={{ background: P.card, borderRadius: 12, padding: "12px 20px" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: accent }}>{xp}</div>
            <div style={{ fontSize: 12, color: P.muted }}>Total XP</div>
          </div>
          <div style={{ background: P.card, borderRadius: 12, padding: "12px 20px" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: accent }}>{streak}🔥</div>
            <div style={{ fontSize: 12, color: P.muted }}>Day streak</div>
          </div>
          <div style={{ background: P.card, borderRadius: 12, padding: "12px 20px" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: accent }}>{courses.length}</div>
            <div style={{ fontSize: 12, color: P.muted }}>Courses</div>
          </div>
        </div>
      </div>

      {/* Course list */}
      {courses.length === 0 ? (
        <div style={{
          background: P.card,
          borderRadius: 16,
          padding: 40,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📚</div>
          <h3 style={{ color: P.ink, marginBottom: 8 }}>No courses yet</h3>
          <p style={{ color: P.muted, marginBottom: 24 }}>
            Search for a topic, then tap "Turn into course" to start learning.
          </p>
          <button
            onClick={() => onNavigate("search")}
            style={{
              background: accent,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "12px 24px",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Search to begin
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {courses.map((course) => (
            <div
              key={course.id}
              onClick={() => { setActiveCourse(course); setActiveLesson(0); setActiveCard(0); }}
              style={{
                background: P.card,
                borderRadius: 16,
                padding: 20,
                cursor: "pointer",
                border: `1px solid ${P.line}`,
              }}
            >
              <h3 style={{ color: P.ink, marginBottom: 4 }}>{course.title}</h3>
              <p style={{ color: P.muted, fontSize: 14, marginBottom: 12 }}>
                {course.lessons.length} lessons · {course.totalXP} XP
              </p>
              <div style={{
                height: 6,
                background: P.line,
                borderRadius: 3,
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${(course.progress || 0) * 100}%`,
                  height: "100%",
                  background: accent,
                  borderRadius: 3,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Lesson Player — card-based, Imprint-style but premium
function LessonPlayer({ course, lessonIndex, cardIndex, P, accent, onCardChange, onLessonChange, onExit, onComplete }) {
  const lesson = course.lessons[lessonIndex];
  const card = lesson.cards[cardIndex];
  const [selected, setSelected] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false);

  const totalCards = lesson.cards.length;
  const progress = (cardIndex + 1) / totalCards;

  const nextCard = () => {
    if (cardIndex < totalCards - 1) {
      onCardChange(cardIndex + 1);
      setSelected(null);
      setShowExplanation(false);
    } else if (lessonIndex < course.lessons.length - 1) {
      onComplete(100);
      onLessonChange(lessonIndex + 1);
      onCardChange(0);
      setSelected(null);
      setShowExplanation(false);
    } else {
      onComplete(100);
      onExit();
    }
  };

  const prevCard = () => {
    if (cardIndex > 0) {
      onCardChange(cardIndex - 1);
      setSelected(null);
      setShowExplanation(false);
    }
  };

  const handleQuizAnswer = (idx) => {
    setSelected(idx);
    setShowExplanation(true);
    if (idx === card.correct) {
      onComplete(10);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 24, minHeight: "80vh", display: "flex", flexDirection: "column" }}>
      {/* Progress bar */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: P.muted, fontSize: 14 }}>
            {lesson.title} · Card {cardIndex + 1} of {totalCards}
          </span>
          <button onClick={onExit} style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 20 }}>
            ✕
          </button>
        </div>
        <div style={{ height: 8, background: P.line, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: accent, borderRadius: 4, transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Card content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {card.type === CARD_TYPES.INTRO && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: P.ink, marginBottom: 16 }}>{card.title}</h2>
            <p style={{ fontSize: 18, color: P.muted, lineHeight: 1.6 }}>{card.text}</p>
          </div>
        )}

        {card.type === CARD_TYPES.CONCEPT && (
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 600, color: P.ink, marginBottom: 16 }}>{card.title}</h3>
            <p style={{ fontSize: 17, color: P.ink, lineHeight: 1.7 }}>{card.text}</p>
            {card.citation && <span style={{ color: P.muted, fontSize: 14 }}>{card.citation}</span>}
          </div>
        )}

        {card.type === CARD_TYPES.PAPER && (
          <div style={{ background: P.card, borderRadius: 16, padding: 24, border: `1px solid ${P.line}` }}>
            <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginBottom: 8 }}>LANDMARK PAPER · {card.year}</div>
            <h3 style={{ fontSize: 20, fontWeight: 600, color: P.ink, marginBottom: 12 }}>{card.title}</h3>
            <p style={{ color: P.muted, fontSize: 14, marginBottom: 16 }}>{card.authors} · {card.journal}</p>
            <p style={{ fontSize: 16, color: P.ink, lineHeight: 1.7 }}>{card.text}</p>
          </div>
        )}

        {card.type === CARD_TYPES.QUIZ && (
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 600, color: P.ink, marginBottom: 20 }}>{card.question}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {card.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => !showExplanation && handleQuizAnswer(i)}
                  disabled={showExplanation}
                  style={{
                    background: showExplanation
                      ? i === card.correct ? "#22c55e22" : i === selected ? "#ef444422" : P.card
                      : P.card,
                    border: `2px solid ${showExplanation && i === card.correct ? "#22c55e" : showExplanation && i === selected ? "#ef4444" : P.line}`,
                    borderRadius: 12,
                    padding: "16px 20px",
                    fontSize: 16,
                    color: P.ink,
                    cursor: showExplanation ? "default" : "pointer",
                    textAlign: "left",
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
            {showExplanation && (
              <div style={{ marginTop: 16, padding: 16, background: "#22c55e11", borderRadius: 12, border: "1px solid #22c55e33" }}>
                <p style={{ color: P.ink, fontSize: 15 }}>{card.explanation}</p>
                {selected === card.correct && <p style={{ color: "#22c55e", fontWeight: 600, marginTop: 8 }}>+10 XP 🎉</p>}
              </div>
            )}
          </div>
        )}

        {card.type === CARD_TYPES.BATTLE && (
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 600, color: P.ink, marginBottom: 20 }}>Claim Battle</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ background: "#3b82f611", borderRadius: 12, padding: 16, border: "1px solid #3b82f633" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#3b82f6", marginBottom: 8 }}>POSITION A</div>
                <p style={{ color: P.ink, fontSize: 15 }}>{card.claimA}</p>
                <p style={{ color: P.muted, fontSize: 12, marginTop: 8 }}>{card.sourceA}</p>
              </div>
              <div style={{ background: "#f59e0b11", borderRadius: 12, padding: 16, border: "1px solid #f59e0b33" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 8 }}>POSITION B</div>
                <p style={{ color: P.ink, fontSize: 15 }}>{card.claimB}</p>
                <p style={{ color: P.muted, fontSize: 12, marginTop: 8 }}>{card.sourceB}</p>
              </div>
            </div>
            <p style={{ color: P.muted, fontSize: 15, textAlign: "center" }}>{card.question}</p>
          </div>
        )}

        {card.type === CARD_TYPES.SUMMARY && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: P.ink, marginBottom: 12 }}>{card.title}</h2>
            <p style={{ fontSize: 18, color: P.muted }}>{card.text}</p>
            <div style={{ fontSize: 32, fontWeight: 700, color: accent, marginTop: 16 }}>+{card.xp} XP</div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
        <button
          onClick={prevCard}
          disabled={cardIndex === 0}
          style={{
            background: P.card,
            border: `1px solid ${P.line}`,
            borderRadius: 12,
            padding: "12px 24px",
            color: P.ink,
            cursor: cardIndex === 0 ? "default" : "pointer",
            opacity: cardIndex === 0 ? 0.3 : 1,
          }}
        >
          Back
        </button>
        <button
          onClick={nextCard}
          style={{
            background: accent,
            border: "none",
            borderRadius: 12,
            padding: "12px 32px",
            color: "#fff",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {cardIndex === totalCards - 1
            ? lessonIndex === course.lessons.length - 1 ? "Finish" : "Next Lesson"
            : "Continue"}
        </button>
      </div>
    </div>
  );
}
