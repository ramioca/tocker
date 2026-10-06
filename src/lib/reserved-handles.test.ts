import { describe, expect, it } from "vitest";
import { FOUNDER_X } from "@/lib/contact";
import { isReservedHandle, isStaffLikeName } from "./reserved-handles";

describe("isReservedHandle", () => {
  it("reserves the product, staff words and the sign-in provider", () => {
    for (const handle of [
      "tocker",
      "tockerxyz",
      "privy",
      "support",
      "help",
      "admin",
      "administrator",
      "team",
      "staff",
      "official",
      "security",
      "mod",
      "moderator",
      "system",
      "root",
    ]) {
      expect(isReservedHandle(handle), handle).toBe(true);
    }
  });

  it("reserves the founder's handle, read from the one place it is written", () => {
    expect(isReservedHandle(FOUNDER_X.handle)).toBe(true);
    expect(isReservedHandle(FOUNDER_X.handle.toUpperCase())).toBe(true);
  });

  it("ignores case", () => {
    expect(isReservedHandle("Support")).toBe(true);
    expect(isReservedHandle("TOCKER")).toBe(true);
    expect(isReservedHandle("  Admin  ")).toBe(true);
  });

  it("reserves anything that starts with the product's name", () => {
    expect(isReservedHandle("tocker_team")).toBe(true);
    expect(isReservedHandle("tocker_support")).toBe(true);
    expect(isReservedHandle("tockerhq")).toBe(true);
    expect(isReservedHandle("Tocker2")).toBe(true);
  });

  it("sees through underscores and digits at either end", () => {
    expect(isReservedHandle("_support")).toBe(true);
    expect(isReservedHandle("support_")).toBe(true);
    expect(isReservedHandle("sup_port")).toBe(true);
    expect(isReservedHandle("support1")).toBe(true);
    expect(isReservedHandle("01admin")).toBe(true);
    expect(isReservedHandle("_t_o_c_k_e_r_")).toBe(true);
  });

  it("leaves ordinary handles alone", () => {
    for (const handle of ["dex", "mila", "trader", "user4f9a2c", "helper", "supporter", "stocker", "teamwork", "rootbeer", "a1", "42"]) {
      expect(isReservedHandle(handle), handle).toBe(false);
    }
  });
});

describe("isStaffLikeName", () => {
  it("refuses a name that reads as the product or its staff, in any case", () => {
    expect(isStaffLikeName("Tocker Support")).toBe(true);
    expect(isStaffLikeName("tocker")).toBe(true);
    expect(isStaffLikeName("OFFICIAL account")).toBe(true);
    expect(isStaffLikeName("Site Admin")).toBe(true);
    expect(isStaffLikeName("Customer support")).toBe(true);
  });

  it("is not fooled by full-width letters or invisible joiners", () => {
    expect(isStaffLikeName("Ｔｏｃｋｅｒ")).toBe(true);
    expect(isStaffLikeName("Toc​ker")).toBe(true);
    expect(isStaffLikeName("sup‍port")).toBe(true);
  });

  it("leaves ordinary names alone", () => {
    for (const name of ["Dex", "Mila K.", "Chad Minor", "Ada Lovelace", ""]) {
      expect(isStaffLikeName(name), name).toBe(false);
    }
  });
});
