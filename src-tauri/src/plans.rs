//! Reading plans the reader has started, and which of their days are done. What each day of a plan reads is worked
//! out by the app from the text; this only remembers ids and day numbers, so a plan can be improved without touching
//! anyone's progress.

use crate::db::{Error, Result};
use rusqlite::{params, Connection};
use serde::Serialize;

/// The most days any plan may have; a bound on what a day number can be.
const MAX_DAY: u32 = 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneDay {
    pub day: u32,
    /// The local date it was marked done, `YYYY-MM-DD`.
    pub done_on: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedPlan {
    pub plan: String,
    pub started_on: String,
    pub done: Vec<DoneDay>,
}

/// Plan ids are short and made of lowercase letters, digits and dashes.
fn check_plan(plan: &str) -> Result<()> {
    let ok = !plan.is_empty()
        && plan.len() <= 40
        && plan
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid(format!("not a plan id: {plan:?}")))
    }
}

/// `YYYY-MM-DD` with a plausible month and day.
fn check_date(date: &str) -> Result<()> {
    let b = date.as_bytes();
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    let ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && digits(0..4)
        && digits(5..7)
        && digits(8..10)
        && {
            let (month, day): (u32, u32) = (
                date[5..7].parse().unwrap_or(0),
                date[8..10].parse().unwrap_or(0),
            );
            (1..=12).contains(&month) && (1..=31).contains(&day)
        };
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid(format!("not a date: {date:?}")))
    }
}

/// Every started plan, oldest first, with its finished days in order.
pub fn get_plans(conn: &Connection) -> Result<Vec<StartedPlan>> {
    let mut plans: Vec<StartedPlan> = conn
        .prepare_cached("SELECT plan, started_on FROM plans ORDER BY started_on, plan")?
        .query_map([], |r| {
            Ok(StartedPlan {
                plan: r.get(0)?,
                started_on: r.get(1)?,
                done: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut days =
        conn.prepare_cached("SELECT day, done_on FROM plan_days WHERE plan = ?1 ORDER BY day")?;
    for p in &mut plans {
        p.done = days
            .query_map(params![p.plan], |r| {
                Ok(DoneDay {
                    day: r.get(0)?,
                    done_on: r.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(plans)
}

/// Starts a plan today (`started_on`). Starting one that is already going changes nothing.
pub fn start_plan(conn: &Connection, plan: &str, started_on: &str) -> Result<()> {
    check_plan(plan)?;
    check_date(started_on)?;
    conn.execute(
        "INSERT OR IGNORE INTO plans (plan, started_on) VALUES (?1, ?2)",
        params![plan, started_on],
    )?;
    Ok(())
}

/// Stops a plan and forgets its progress.
pub fn stop_plan(conn: &Connection, plan: &str) -> Result<()> {
    check_plan(plan)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM plan_days WHERE plan = ?1", params![plan])?;
    tx.execute("DELETE FROM plans WHERE plan = ?1", params![plan])?;
    tx.commit()?;
    Ok(())
}

/// Marks a day of a started plan done (on `done_on`, unless it already was, which keeps its original date) or undone.
pub fn set_day(conn: &Connection, plan: &str, day: u32, done: bool, done_on: &str) -> Result<()> {
    check_plan(plan)?;
    if !(1..=MAX_DAY).contains(&day) {
        return Err(Error::Invalid(format!("not a day: {day}")));
    }
    let started: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM plans WHERE plan = ?1)",
        params![plan],
        |r| r.get(0),
    )?;
    if !started {
        return Err(Error::Invalid(format!("plan {plan} has not been started")));
    }
    if done {
        check_date(done_on)?;
        conn.execute(
            "INSERT OR IGNORE INTO plan_days (plan, day, done_on) VALUES (?1, ?2, ?3)",
            params![plan, day, done_on],
        )?;
    } else {
        conn.execute(
            "DELETE FROM plan_days WHERE plan = ?1 AND day = ?2",
            params![plan, day],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, migrated, in-memory user database.
    fn conn() -> Connection {
        crate::user::open(std::path::Path::new(":memory:")).unwrap()
    }

    #[test]
    fn starts_plans_and_lists_them_oldest_first() {
        let c = conn();
        assert!(get_plans(&c).unwrap().is_empty());
        start_plan(&c, "nt-90", "2026-09-22").unwrap();
        start_plan(&c, "bible-year", "2026-01-01").unwrap();
        let plans = get_plans(&c).unwrap();
        assert_eq!(
            plans.iter().map(|p| p.plan.as_str()).collect::<Vec<_>>(),
            ["bible-year", "nt-90"]
        );
        assert_eq!(plans[1].started_on, "2026-09-22");
        assert!(plans.iter().all(|p| p.done.is_empty()));
    }

    #[test]
    fn starting_a_plan_again_keeps_its_date_and_progress() {
        let c = conn();
        start_plan(&c, "nt-90", "2026-09-01").unwrap();
        set_day(&c, "nt-90", 1, true, "2026-09-01").unwrap();
        start_plan(&c, "nt-90", "2026-09-22").unwrap();
        let p = &get_plans(&c).unwrap()[0];
        assert_eq!(p.started_on, "2026-09-01");
        assert_eq!(p.done.len(), 1);
    }

    #[test]
    fn marks_days_done_and_undone_in_order() {
        let c = conn();
        start_plan(&c, "gospels-30", "2026-09-01").unwrap();
        set_day(&c, "gospels-30", 3, true, "2026-09-03").unwrap();
        set_day(&c, "gospels-30", 1, true, "2026-09-01").unwrap();
        let days: Vec<_> = get_plans(&c).unwrap()[0]
            .done
            .iter()
            .map(|d| (d.day, d.done_on.clone()))
            .collect();
        assert_eq!(
            days,
            [(1, "2026-09-01".to_string()), (3, "2026-09-03".to_string())]
        );
        set_day(&c, "gospels-30", 1, false, "").unwrap();
        assert_eq!(get_plans(&c).unwrap()[0].done.len(), 1);
    }

    #[test]
    fn a_day_marked_twice_keeps_its_first_date() {
        let c = conn();
        start_plan(&c, "nt-90", "2026-09-01").unwrap();
        set_day(&c, "nt-90", 1, true, "2026-09-01").unwrap();
        set_day(&c, "nt-90", 1, true, "2026-09-09").unwrap();
        assert_eq!(get_plans(&c).unwrap()[0].done[0].done_on, "2026-09-01");
    }

    #[test]
    fn stopping_a_plan_forgets_its_progress_and_leaves_others() {
        let c = conn();
        start_plan(&c, "a", "2026-09-01").unwrap();
        start_plan(&c, "b", "2026-09-01").unwrap();
        set_day(&c, "a", 1, true, "2026-09-01").unwrap();
        set_day(&c, "b", 1, true, "2026-09-01").unwrap();
        stop_plan(&c, "a").unwrap();
        let plans = get_plans(&c).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!((plans[0].plan.as_str(), plans[0].done.len()), ("b", 1));
        let orphans: u32 = c
            .query_row("SELECT COUNT(*) FROM plan_days WHERE plan = 'a'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(orphans, 0);
        stop_plan(&c, "never-started").unwrap();
    }

    #[test]
    fn a_day_needs_a_started_plan() {
        let c = conn();
        assert!(set_day(&c, "nt-90", 1, true, "2026-09-01").is_err());
    }

    #[test]
    fn rejects_bad_ids_days_and_dates_without_changing_anything() {
        let c = conn();
        for id in [
            "",
            "Has Caps",
            "a/b",
            "x'; DROP TABLE plans;--",
            &"a".repeat(41),
        ] {
            assert!(start_plan(&c, id, "2026-09-01").is_err(), "{id:?}");
        }
        for date in [
            "",
            "2026-9-1",
            "26-09-01",
            "2026-13-01",
            "2026-00-10",
            "2026-09-32",
            "2026/09/01",
            "abcd-ef-gh",
        ] {
            assert!(start_plan(&c, "ok", date).is_err(), "{date:?}");
        }
        assert!(get_plans(&c).unwrap().is_empty());
        start_plan(&c, "ok", "2026-09-01").unwrap();
        assert!(set_day(&c, "ok", 0, true, "2026-09-01").is_err());
        assert!(set_day(&c, "ok", 1001, true, "2026-09-01").is_err());
        assert!(set_day(&c, "ok", 1, true, "yesterday").is_err());
        assert!(get_plans(&c).unwrap()[0].done.is_empty());
    }
}
