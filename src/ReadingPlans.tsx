import { useMemo, useRef, useState } from "react";
import type { Book, StartedPlan } from "./api";
import type { Destination } from "./GoTo";
import { chapterTitle } from "./nav";
import { allDoneDates, dayLabel, nextDay, progress, streak } from "./plans";
import type { Plan, PlanDay } from "./plans";
import { useKeepFocus } from "./useKeepFocus";
import { useReturnFocus } from "./useReturnFocus";

interface Props {
  books: Book[];
  plans: Plan[];
  started: StartedPlan[];
  /** Today's date, `YYYY-MM-DD`, for the streak. */
  today: string;
  onStart: (plan: string) => void;
  /** Stops a plan and forgets its progress. */
  onStop: (plan: string) => void;
  /** Stops a finished plan and starts it again from day one. */
  onRestart: (plan: string) => void;
  onSetDay: (plan: string, day: number, done: boolean) => void;
  onGo: (dest: Destination) => void;
  onClose: () => void;
}

/** Where a day begins: its first chapter. */
const start = (day: PlanDay): Destination => ({ book: day.chapters[0].book, chapter: day.chapters[0].chapter });

/** The reading plans on offer and the ones under way, with what to read next. */
export function ReadingPlans({ books, plans, started, today, onStart, onStop, onRestart, onSetDay, onGo, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null); // the plan whose days are listed
  const [confirming, setConfirming] = useState<string | null>(null); // the plan about to be stopped

  useReturnFocus();
  useKeepFocus(panelRef);

  const titleOf = useMemo(() => {
    const byId = new Map(books.map((b) => [b.id, chapterTitle(b)]));
    return (id: number) => byId.get(id) ?? "";
  }, [books]);

  const startedById = new Map(started.map((s) => [s.plan, s]));
  const going = plans.filter((p) => startedById.has(p.id));
  const offered = plans.filter((p) => !startedById.has(p.id));
  const run = streak(allDoneDates(started), today);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto plans"
        role="dialog"
        aria-modal="true"
        aria-label="Reading plans"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="plans-head">
          <h2 className="plans-title">Reading plans</h2>
          {run >= 2 && <span className="plans-streak">{run}-day streak</span>}
        </div>

        <div className="plans-body">
          {going.length > 0 && (
            <section aria-label="Plans under way">
              <ul className="plans-list">
                {going.map((plan) => {
                  const s = startedById.get(plan.id)!;
                  const done = new Set(s.done.map((d) => d.day));
                  const pr = progress(plan, done);
                  const next = nextDay(plan, done);
                  const listed = open === plan.id;
                  const stopping = confirming === plan.id;
                  return (
                    <li key={plan.id} className="plan" data-plan={plan.id}>
                      <div className="plan-top">
                        <h3 className="plan-name">{plan.name}</h3>
                        <span className="plan-count">
                          {pr.done} of {pr.total} days
                        </span>
                      </div>
                      <div
                        className="plan-bar"
                        role="progressbar"
                        aria-label={`${plan.name} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pr.percent}
                      >
                        <span style={{ width: `${pr.percent}%` }} />
                      </div>

                      {next ? (
                        <div className="plan-next">
                          <p className="plan-next-what">
                            <span className="plan-label">Day {next.day}</span>
                            {dayLabel(next, titleOf)}
                          </p>
                          <div className="plan-actions">
                            <button className="plan-read" onClick={() => onGo(start(next))}>
                              Read
                            </button>
                            <button className="plan-done" onClick={() => onSetDay(plan.id, next.day, true)}>
                              Mark day done
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="plan-finished" role="status">
                          Finished. Well done.
                        </p>
                      )}

                      <div className="plan-more">
                        <button aria-expanded={listed} onClick={() => setOpen(listed ? null : plan.id)}>
                          {listed ? "Hide the days" : "All the days"}
                        </button>
                        {pr.finished && (
                          <button onClick={() => onRestart(plan.id)}>Start over</button>
                        )}
                        {stopping ? (
                          <span className="plan-confirm" role="group" aria-label="Stop this plan?">
                            Forget your progress?
                            <button className="plan-danger" onClick={() => onStop(plan.id)}>
                              Stop the plan
                            </button>
                            <button onClick={() => setConfirming(null)}>Keep it</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => (pr.done === 0 ? onStop(plan.id) : setConfirming(plan.id))}
                          >
                            Stop
                          </button>
                        )}
                      </div>

                      {listed && (
                        <ol className="plan-days">
                          {plan.days.map((d) => (
                            <li key={d.day} className="plan-day" data-done={done.has(d.day) ? "" : undefined}>
                              <button
                                role="checkbox"
                                aria-checked={done.has(d.day)}
                                className="plan-check"
                                onClick={() => onSetDay(plan.id, d.day, !done.has(d.day))}
                              >
                                <span className="plan-box" aria-hidden="true" />
                                <span className="plan-day-n">Day {d.day}</span>
                                <span className="plan-day-what">{dayLabel(d, titleOf)}</span>
                              </button>
                              <button className="plan-go" aria-label={`Read day ${d.day}`} onClick={() => onGo(start(d))}>
                                Read
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {offered.length > 0 && (
            <section aria-label="Start a plan">
              <h3 className="plans-subhead">{going.length > 0 ? "Start another" : "Choose a plan"}</h3>
              <ul className="plans-list">
                {offered.map((plan) => (
                  <li key={plan.id} className="plan plan-offer" data-plan={plan.id}>
                    <div className="plan-top">
                      <h3 className="plan-name">{plan.name}</h3>
                      <span className="plan-count">{plan.days.length} days</span>
                    </div>
                    <p className="plan-blurb">{plan.blurb}</p>
                    <div className="plan-actions">
                      <button className="plan-read" onClick={() => onStart(plan.id)}>
                        Start
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="goto-footer">
          <span>Skip a day and nothing is lost.</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
