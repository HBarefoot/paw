export interface CronSchedule {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(",")) {
    // Handle */step
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (range !== "*") {
        if (range.includes("-")) {
          [start, end] = range.split("-").map(Number);
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (part.includes("-")) {
      // Handle range
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else if (part === "*") {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return [...values].filter((v) => v >= min && v <= max).sort((a, b) => a - b);
}

export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
  }

  return {
    minutes: parseField(fields[0], 0, 59),
    hours: parseField(fields[1], 0, 23),
    daysOfMonth: parseField(fields[2], 1, 31),
    months: parseField(fields[3], 1, 12),
    daysOfWeek: parseField(fields[4], 0, 6),
  };
}

export function isValidCron(expression: string): boolean {
  try {
    const schedule = parseCron(expression);
    // Ensure all fields have at least one valid value
    return (
      schedule.minutes.length > 0 &&
      schedule.hours.length > 0 &&
      schedule.daysOfMonth.length > 0 &&
      schedule.months.length > 0 &&
      schedule.daysOfWeek.length > 0
    );
  } catch {
    return false;
  }
}

function toTimezone(date: Date, timezone: string): Date {
  const str = date.toLocaleString("en-US", { timeZone: timezone });
  return new Date(str);
}

export function nextRun(schedule: CronSchedule, after = new Date(), timezone = "UTC"): Date {
  const tzNow = toTimezone(after, timezone);
  let candidate = new Date(tzNow);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1); // start from next minute

  // Search up to 1 year ahead
  const maxIterations = 525960; // ~1 year in minutes
  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1;
    const dom = candidate.getDate();
    const dow = candidate.getDay();
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();

    if (
      schedule.months.includes(month) &&
      schedule.daysOfMonth.includes(dom) &&
      schedule.daysOfWeek.includes(dow) &&
      schedule.hours.includes(hour) &&
      schedule.minutes.includes(minute)
    ) {
      // Convert back from timezone to UTC
      const offset = after.getTime() - tzNow.getTime();
      return new Date(candidate.getTime() + offset);
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error("Could not find next run time within 1 year");
}
