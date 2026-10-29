import { useState } from "react";
import { Popover } from "../chrome/Popover";
import { TeamCardButton } from "../chrome/TeamCard";
import type { CrewCardChoice } from "../lib/crewActions";
import { crewEffortSetting } from "../lib/crewModels";
import {
  CREW_LIMIT_RANGES,
  crewMemberApp,
  crewMemberById,
  crewMemberName,
  routeCard,
  type Crew,
} from "../lib/crews";
import { pickerModelsFor, preferredModelId, findModel } from "../lib/models";
import { HARNESS_TITLE } from "../lib/session";
import "../chrome/TeamCard.css";
import "./CrewBoard.css";

const AUTO = "";

/**
 * Give to crew, your way: who builds it and who checks it (Auto lets the
 * crew's rules pick), the Builder's model and effort for this card only,
 * and its rounds. Nothing here changes what a member may do.
 */
export function CrewGiveChooser({
  crew,
  card,
  anchor,
  onGive,
  onClose,
}: {
  crew: Crew;
  card: { title: string; note?: string };
  anchor: HTMLElement;
  onGive: (choice: CrewCardChoice) => void;
  onClose: () => void;
}) {
  const builders = crew.members.filter((member) => member.role === "builder");
  const checkers = crew.members.filter((member) => member.role === "checker");
  const routed = routeCard(crew, card);
  const firstChecker = checkers.find((member) => !member.paused);
  const [builderId, setBuilderId] = useState(AUTO);
  const [checkerId, setCheckerId] = useState(AUTO);
  const [model, setModel] = useState(AUTO);
  const [effort, setEffort] = useState(AUTO);
  const [rounds, setRounds] = useState(crew.limits.roundsPerCard);
  const builder = crewMemberById(crew, builderId || routed?.id);
  const app = crewMemberApp(builder);
  const ownModel = app.model ?? preferredModelId(app.harness);
  const models = pickerModelsFor(app.harness);
  const shownModel = model || ownModel;
  const efforts = crewEffortSetting(app.harness, shownModel);
  const name = (id: string) => crewMemberName(crew, id);
  const modelName = (id: string) => findModel(id)?.name ?? id;
  const [low, high] = CREW_LIMIT_RANGES.roundsPerCard;
  return (
    <Popover
      anchor={anchor}
      side="bottom"
      align="start"
      width={300}
      autoFocus
      onDismiss={onClose}
      role="dialog"
      aria-label={`Give “${card.title}” to the crew`}
      className="crew-give-chooser"
      data-crew-give-chooser
    >
      <form
        className="crew-give-form"
        onSubmit={(event) => {
          event.preventDefault();
          onGive({
            ...(builderId ? { builderId } : {}),
            ...(checkerId ? { checkerId } : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            maxRounds: rounds,
          });
        }}
      >
        <p className="crew-give-title">Give “{card.title}” to</p>
        <label className="crew-give-field">
          <span>Builder</span>
          <select
            className="aven-field"
            value={builderId}
            onChange={(event) => {
              setBuilderId(event.target.value);
              // Another Builder may run on another app: its own model then.
              setModel(AUTO);
              setEffort(AUTO);
            }}
          >
            <option value={AUTO}>
              Auto{routed ? ` · ${name(routed.id)}` : ""}
            </option>
            {builders.map((member) => (
              <option key={member.id} value={member.id}>
                {name(member.id)}
                {member.paused ? " (off)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="crew-give-field">
          <span>Checker</span>
          <select
            className="aven-field"
            value={checkerId}
            onChange={(event) => setCheckerId(event.target.value)}
          >
            <option value={AUTO}>
              Auto{firstChecker ? ` · ${name(firstChecker.id)}` : ""}
            </option>
            {checkers.map((member) => (
              <option key={member.id} value={member.id}>
                {name(member.id)}
                {member.paused ? " (off)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="crew-give-field">
          <span>Model, for this card</span>
          <select
            className="aven-field"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setEffort(AUTO);
            }}
          >
            <option value={AUTO}>
              {builder ? `${name(builder.id)}'s own` : "The Builder's own"} ·{" "}
              {modelName(ownModel)}
            </option>
            {models
              .filter((item) => item.id !== ownModel)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {HARNESS_TITLE[item.harness]} · {item.name}
                </option>
              ))}
          </select>
        </label>
        <div className="crew-give-pair">
          {efforts ? (
            <label className="crew-give-field">
              <span>Effort</span>
              <select
                className="aven-field"
                value={effort}
                onChange={(event) => setEffort(event.target.value)}
              >
                <option value={AUTO}>
                  {builder?.effort && !model ? builder.effort : "Default"}
                </option>
                {efforts.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="crew-give-field">
            <span>Rounds</span>
            <select
              className="aven-field"
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value))}
            >
              {Array.from(
                { length: high - low + 1 },
                (_, index) => low + index,
              ).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="crew-give-actions">
          <TeamCardButton size="compact" variant="ghost" onClick={onClose}>
            Cancel
          </TeamCardButton>
          <TeamCardButton size="compact" variant="primary" type="submit">
            Give to crew
          </TeamCardButton>
        </div>
      </form>
    </Popover>
  );
}
