import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddToCalendarButton from "./AddToCalendarButton.jsx";

describe("AddToCalendarButton", () => {
  it("adds the event URL to the Google Calendar details", async () => {
    const user = userEvent.setup();

    render(
      <AddToCalendarButton
        eventData={{
          id: "event-42",
          name: "Párty",
          description: "Popis akce",
          location: "Praha",
          datetime: "2026-01-05T18:00:00",
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Přidat do kalendáře" }),
    );

    const link = await screen.findByRole("link", { name: "Google Calendar" });
    const href = link.getAttribute("href");

    expect(href).toContain("event-42");
    expect(href).toContain("event%2Fevent-42");
  });
});
