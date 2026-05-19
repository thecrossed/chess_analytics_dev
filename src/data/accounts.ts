import type { UserAccount } from "../types";

export const accounts: UserAccount[] = [
  {
    id: "coach-elena",
    role: "coach",
    name: "Elena Kovac",
    email: "coach@chesscoach.local",
    password: "coach123"
  },
  {
    id: "account-maya",
    role: "student",
    name: "Maya Chen",
    email: "maya@chesscoach.local",
    password: "student123",
    studentId: "student-maya"
  },
  {
    id: "account-lucas",
    role: "student",
    name: "Lucas Rivera",
    email: "lucas@chesscoach.local",
    password: "student123",
    studentId: "student-lucas"
  },
  {
    id: "account-ava",
    role: "student",
    name: "Ava Thompson",
    email: "ava@chesscoach.local",
    password: "student123",
    studentId: "student-ava"
  }
];
