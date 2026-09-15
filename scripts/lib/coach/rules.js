#!/usr/bin/env node
/**
 * Coaching rules for the AI-literacy coach.
 *
 * Each rule splits two questions that are easy to conflate:
 *
 *   applies(f) — was this rule RELEVANT to this prompt?
 *   matches(f) — is the defect PRESENT?
 *
 * Mastery is credited only on prompts where `applies && !matches`. Without the
 * split, a rule about missing tests would "graduate" off five prompts like
 * "what does this file do?", where tests were never the point. That split is
 * also what makes the improvement loop possible: a note that fires often but
 * never produces a clean streak is a note that is not landing, and that is
 * only visible because we track relevance separately from the defect.
 *
 * Notes state a WHY, never a scold, and come in two lengths. The short form is
 * used when .claude/identity.json asks for minimal verbosity.
 *
 * Adding a rule: give it a unique id, exactly one topic from TOPICS, both
 * languages, both lengths, and add it to skills/ai-literacy-coach/SKILL.md.
 * RULE_IDS is frozen at load and is the whitelist the state writer enforces,
 * so a rule that is not here can never write to disk.
 */

'use strict';

const RULE_VERSION = '1';

const TOPICS = Object.freeze(['specification', 'scoping', 'planning', 'verification', 'tooling']);

const RULES = Object.freeze([
  {
    id: 'vague-scope',
    topic: 'scoping',
    severity: 5,
    applies: f => f.isTaskRequest,
    matches: f => f.vagueScope,
    note: {
      en: {
        short: 'Unbounded scope. Name the one file or behavior you want changed — otherwise I pick, and I will pick wrong.',
        long: 'This asks for unbounded scope ("everything", "the whole thing"). I have to guess where to stop, and I will usually guess a different boundary than you meant — then you review a diff you did not want. Name the one file, function, or behavior that should change.',
      },
      es: {
        short: 'Alcance sin límite. Decime qué archivo o comportamiento cambiar — si no, elijo yo, y voy a elegir mal.',
        long: 'Esto pide un alcance sin límite ("todo", "el código entero"). Tengo que adivinar dónde parar, y casi siempre voy a elegir un borde distinto del que querías — y terminás revisando un diff que no pediste. Decime el archivo, la función o el comportamiento concreto.',
      },
    },
  },
  {
    id: 'no-acceptance-criteria',
    topic: 'specification',
    severity: 4,
    applies: f => f.isTaskRequest && f.wordCount >= 6,
    matches: f => !f.hasAcceptanceLanguage,
    note: {
      en: {
        short: 'No "done when". Without a finish line I pick one, and I pick a smaller one than you meant.',
        long: 'There is no acceptance criterion here. Without a stated "done when", I choose the finish line myself — and I reliably choose a smaller one than you had in mind. One line fixes it: "done when X passes and Y is unchanged."',
      },
      es: {
        short: 'Falta el "listo cuando". Sin meta explícita elijo yo, y elijo una más chica de la que querías.',
        long: 'No hay criterio de aceptación. Sin un "listo cuando", la meta la elijo yo — y sistemáticamente elijo una más chica de la que tenías en mente. Se arregla con una línea: "listo cuando pasa X y no cambia Y".',
      },
    },
  },
  {
    id: 'code-before-plan',
    topic: 'planning',
    severity: 4,
    applies: f => f.isTaskRequest && f.clauseCount >= 2,
    matches: f => !f.wantsPlan && (f.lenBucket === 'l' || f.lenBucket === 'xl'),
    note: {
      en: {
        short: 'Long enough to be worth a plan first. Ask for the approach, then approve it, then let me write code.',
        long: 'This is long enough that a wrong assumption early costs the whole turn. Asking for the approach first — and approving it — is cheaper than reviewing code built on a premise you would have rejected in one sentence.',
      },
      es: {
        short: 'Es largo como para pedir el plan antes. Pedí el enfoque, aprobalo, y recién ahí que escriba código.',
        long: 'Esto es lo bastante largo como para que una suposición equivocada al principio te cueste el turno entero. Pedir primero el enfoque —y aprobarlo— sale más barato que revisar código construido sobre una premisa que habrías rechazado en una frase.',
      },
    },
  },
  {
    id: 'no-file-anchors',
    topic: 'specification',
    severity: 3,
    applies: f => f.isTaskRequest && f.wordCount >= 4,
    matches: f => !f.hasPathLike && !f.hasCodeFence && !f.hasBacktickIdent,
    note: {
      en: {
        short: 'No file, path, or identifier named. I will spend the first half of this turn searching instead of working.',
        long: 'Nothing here anchors to the code: no path, no identifier, no snippet. I will spend the first half of this turn searching for what you already know the name of. Even one filename or function name changes that.',
      },
      es: {
        short: 'No nombrás archivo, ruta ni identificador. Voy a gastar media respuesta buscando en vez de trabajar.',
        long: 'Nada acá ancla al código: ni ruta, ni identificador, ni fragmento. Voy a gastar la primera mitad del turno buscando algo cuyo nombre vos ya sabés. Con un solo nombre de archivo o de función cambia.',
      },
    },
  },
  {
    id: 'unused-ecc-component',
    topic: 'tooling',
    severity: 3,
    applies: f => f.skillHint !== null,
    matches: f => f.skillHint !== null,
    note: {
      en: {
        short: 'There is a skill for this: {component}. Naming it loads instructions written for exactly this task.',
        long: 'This repository ships a {kind} for this kind of work: {component}. Naming it loads instructions written for exactly this task, instead of making me reconstruct the approach from scratch this turn and slightly differently the next.',
      },
      es: {
        short: 'Hay una skill para esto: {component}. Nombrarla carga instrucciones escritas para esta tarea exacta.',
        long: 'Este repo trae un {kind} para este tipo de trabajo: {component}. Nombrarlo carga instrucciones escritas para esta tarea exacta, en vez de que yo reconstruya el enfoque desde cero este turno y un poco distinto al siguiente.',
      },
    },
  },
  {
    id: 'better-as-plan-mode',
    topic: 'planning',
    severity: 3,
    applies: f => f.isTaskRequest && f.clauseCount >= 3,
    matches: f => !f.wantsPlan,
    note: {
      en: {
        short: 'Several asks at once. Plan mode would let you approve the shape before any of it is built.',
        long: 'There are several independent asks stacked here. Plan mode exists for this: you see the whole shape and approve it before anything gets built, instead of discovering on the third item that the first one went the wrong way.',
      },
      es: {
        short: 'Varios pedidos juntos. El modo plan te deja aprobar la forma antes de que se construya nada.',
        long: 'Hay varios pedidos independientes apilados. El modo plan existe para esto: ves la forma completa y la aprobás antes de que se construya nada, en vez de descubrir en el tercer punto que el primero salió para otro lado.',
      },
    },
  },
  {
    id: 'stacked-asks',
    topic: 'scoping',
    severity: 2,
    applies: f => f.isTaskRequest,
    matches: f => f.clauseCount >= 3,
    note: {
      en: {
        short: 'Several tasks in one message. Split them and each one gets a real review.',
        long: 'Several tasks are bundled into one message. Bundled work gets reviewed as one blob, so a mistake in the small task hides inside the diff of the big one. Sent separately, each gets an actual review.',
      },
      es: {
        short: 'Varias tareas en un mensaje. Separalas y cada una recibe una revisión de verdad.',
        long: 'Hay varias tareas juntas en un mensaje. El trabajo agrupado se revisa como un bloque, así que un error en la tarea chica se esconde dentro del diff de la grande. Por separado, cada una recibe revisión real.',
      },
    },
  },
  {
    id: 'no-test-mention',
    topic: 'verification',
    severity: 2,
    applies: f => f.isTaskRequest && !f.wantsPlan,
    matches: f => !f.mentionsTests,
    note: {
      en: {
        short: 'No mention of how this gets verified. "And a test that fails without the fix" is the whole ask.',
        long: 'Nothing here says how the change gets verified. Without that, "done" means "it looked right to me" — which is exactly the standard that lets a regression through. Adding "and a test that fails without the fix" is the whole ask.',
      },
      es: {
        short: 'No decís cómo se verifica. "Y un test que falle sin el arreglo" es todo lo que hay que agregar.',
        long: 'Nada acá dice cómo se verifica el cambio. Sin eso, "listo" significa "me pareció bien" — que es justamente el criterio por el que se cuela una regresión. Agregar "y un test que falle sin el arreglo" es todo el pedido.',
      },
    },
  },
]);

const RULE_IDS = Object.freeze(RULES.map(r => r.id));
const RULES_BY_ID = Object.freeze(Object.fromEntries(RULES.map(r => [r.id, r])));

function rulesForTopic(topic) {
  return RULES.filter(r => r.topic === topic);
}

module.exports = { RULES, RULE_IDS, RULES_BY_ID, RULE_VERSION, TOPICS, rulesForTopic };
