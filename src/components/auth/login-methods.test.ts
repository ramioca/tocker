import { describe, expect, it } from "vitest";
import { DEFAULT_LOGIN_METHODS, LOGIN_METHODS, parseLoginMethods } from "./login-methods";

describe("parseLoginMethods", () => {
  it("falls back to email and wallet when nothing is set", () => {
    expect(parseLoginMethods(undefined)).toEqual(["email", "wallet"]);
    expect(parseLoginMethods(null)).toEqual(["email", "wallet"]);
    expect(parseLoginMethods("")).toEqual(["email", "wallet"]);
    expect(parseLoginMethods("  ")).toEqual(["email", "wallet"]);
    expect(parseLoginMethods(" , ,")).toEqual(["email", "wallet"]);
  });

  it("keeps the default constant and the fallback in step", () => {
    expect(parseLoginMethods(DEFAULT_LOGIN_METHODS)).toEqual(parseLoginMethods(undefined));
  });

  it("accepts every method the card can draw", () => {
    expect(parseLoginMethods("email,google,twitter,passkey,wallet")).toEqual([...LOGIN_METHODS]);
  });

  it("returns the card's order, not the order typed, and no duplicates", () => {
    expect(parseLoginMethods("wallet,google,email,wallet,google")).toEqual(["email", "google", "wallet"]);
  });

  it("ignores case and the spaces around a name", () => {
    expect(parseLoginMethods(" Email , GOOGLE ")).toEqual(["email", "google"]);
  });

  it("drops names it does not know", () => {
    expect(parseLoginMethods("email,discord,google,sms")).toEqual(["email", "google"]);
    // `x` is not an alias: the vendor's name for the method is `twitter`.
    expect(parseLoginMethods("email,x")).toEqual(["email"]);
  });

  it("falls back to the default when nothing in the value is valid", () => {
    expect(parseLoginMethods("discord,sms")).toEqual(["email", "wallet"]);
    // Commas are the only separator, so this is one unknown name, not two known ones.
    expect(parseLoginMethods("email google")).toEqual(["email", "wallet"]);
  });

  /** Invitations are matched on an email address, so email can never be switched off. */
  it("adds email back when the value leaves it out", () => {
    expect(parseLoginMethods("google")).toEqual(["email", "google"]);
    expect(parseLoginMethods("wallet")).toEqual(["email", "wallet"]);
    expect(parseLoginMethods("twitter,passkey")).toEqual(["email", "twitter", "passkey"]);
  });

  it("lets a method that is on by default be switched off", () => {
    expect(parseLoginMethods("email")).toEqual(["email"]);
  });
});
