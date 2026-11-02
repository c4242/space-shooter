// The story campaign: "The Rift Signal". Each chapter is given at a station,
// then runs through steps: reach a nav point (which may spawn enemies), kill
// everything spawned, and dock somewhere to finish.

export const STORY = [
  {
    title: 'Static on the Rift',
    giver: { sys: 'sable', station: 0, who: 'Dr. Ilse Varro, Rift Survey Office' },
    brief: `"Pilot, a moment. Our survey beacon near the Sable Rift went silent two days ago, right after it logged a burst of traffic it shouldn't have seen. ` +
      `Fly out to the Rift Survey Beacon, pull its data core, and bring it back here. Mind the gravity well: the beacon sits on the edge of it."`,
    steps: [
      { do: 'reach', sys: 'sable', nav: 4, r: 2600, text: 'Fly to the Rift Survey Beacon', done: 'Data core recovered.', spawn: [['pirate', 3]], spawnMsg: 'Ashfang: That data is ours, courier!' },
      { do: 'kill', text: 'Destroy the Ashfang ambush' },
      { do: 'dock', sys: 'sable', station: 0, text: 'Return the data core to Meridian Highport' },
    ],
    reward: 3000,
    debrief: `Varro: "These logs show Ashfang ships running the Hollow Reach jump gate at all hours, hauling something heavy. And someone wanted this kept quiet badly enough to kill for it. I have more work for you, when you're ready."`,
  },
  {
    title: 'Into the Hollow',
    giver: { sys: 'sable', station: 0, who: 'Dr. Ilse Varro, Rift Survey Office' },
    brief: `"I need eyes on Gallows Rock, the Ashfang outpost in Hollow Reach. Take the Hollow Reach gate, fly within a few kilometres of the outpost and let your sensors record its docking traffic. ` +
      `Then take the recording to Commodore Hale at Corvane Shipyards. The Authority will want this. Expect to be noticed."`,
    steps: [
      { do: 'reach', sys: 'hollow', nav: 0, r: 4000, text: 'Scan Gallows Rock in Hollow Reach', done: 'Scan complete!', spawn: [['pirate', 2], ['marauder', 1]], spawnMsg: 'Gallows Rock: We see you, spy. Burn them!' },
      { do: 'kill', text: 'Survive the Gallows Rock response' },
      { do: 'dock', sys: 'corvane', station: 0, text: 'Deliver the scan to Corvane Shipyards' },
    ],
    reward: 4500,
    debrief: `Commodore Hale: "So Varro was right. That's a weapons pipeline: stolen Authority torpedo stock, moving through the Reach. ` +
      `If you're willing, I have a job that will hurt them. Speak to me when you're ready."`,
  },
  {
    title: 'Convoy Interdiction',
    giver: { sys: 'corvane', station: 0, who: 'Commodore Hale, Corvane Admiralty' },
    brief: `"An Ashfang convoy is crossing the Glass Belt right under our noses with stolen torpedoes aboard. Intercept it at the Glass Belt and destroy the haulers. ` +
      `I've had two torpedoes loaded on your rack. Torpedoes need a long lock, but nothing that size survives one."`,
    grant: { torpedo: 2 },
    steps: [
      { do: 'reach', sys: 'corvane', nav: 2, r: 6000, text: 'Intercept the convoy at the Glass Belt', done: 'Convoy sighted. Haulers first!', spawn: [['smuggler', 2], ['pirate', 2]], spawnMsg: 'Ashfang convoy: Escorts, form up!' },
      { do: 'kill', text: 'Destroy the convoy and its escorts' },
      { do: 'dock', sys: 'corvane', station: 0, text: 'Report to Commodore Hale' },
    ],
    reward: 6500,
    debrief: `Hale: "Clean work. But Krell, the Ashfang warlord, will want your head for this. ` +
      `His flagship, the Talon, sits at Krell's Anchorage in Hollow Reach. My patrols can't go there without starting a war. You can. Come back when you're ready to end this."`,
  },
  {
    title: 'The Warlord',
    giver: { sys: 'corvane', station: 0, who: 'Commodore Hale, Corvane Admiralty' },
    brief: `"This is it. Fly to Krell's Anchorage in Hollow Reach and destroy the Talon. It's heavily shielded, carries six missiles and won't come alone. ` +
      `Upgrade everything you can, stock decoys, and bring torpedoes. Afterwards, go home to Meridian Highport. Varro will want to hear it from you."`,
    steps: [
      { do: 'reach', sys: 'hollow', nav: 2, r: 6000, text: "Fly to Krell's Anchorage in Hollow Reach", done: 'The Talon is here.', spawn: [['warlord', 1], ['marauder', 1], ['pirate', 2]], spawnMsg: 'Krell: So you are the courier who robbed me. The Rift is too good for you.' },
      { do: 'kill', text: "Destroy Krell's Talon and its escorts" },
      { do: 'dock', sys: 'sable', station: 0, text: 'Return to Meridian Highport' },
    ],
    reward: 15000,
    debrief: `Varro: "Krell's gone, the pipeline's broken and the lanes are quiet for the first time in years. ` +
      `The Rift keeps its own secrets, but you've earned a place out here, pilot. Fly safe." CAMPAIGN COMPLETE.`,
  },
];

export function newStory() { return { ch: 0, active: false, step: 0, spawned: false }; }

export function currentStep(story) {
  if (!story.active) return null;
  return STORY[story.ch].steps[story.step];
}
