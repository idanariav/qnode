/**
 * Micromark syntax extensions and mdast-util-from-markdown utilities for:
 *   - [[wikilink]] and [[wikilink|alias]]
 *   - (Key:: [[target]]) and (Key:: [[target|alias]])  inline field annotations
 */

import type {
  Code,
  Effects,
  State,
  TokenizeContext,
  Construct,
  Extension as MicromarkExtension,
} from "micromark-util-types";
import type {
  Extension as FromMarkdownExtension,
} from "mdast-util-from-markdown";
import type { Node } from "unist";

// Extend the micromark token registry with our custom token names.
declare module "micromark-util-types" {
  interface TokenTypeMap {
    wikilink: "wikilink";
    wikilinkOpenMarker: "wikilinkOpenMarker";
    wikilinkContent: "wikilinkContent";
    wikilinkCloseMarker: "wikilinkCloseMarker";
    inlineField: "inlineField";
    inlineFieldOpenParen: "inlineFieldOpenParen";
    inlineFieldKey: "inlineFieldKey";
    inlineFieldSeparator: "inlineFieldSeparator";
    inlineFieldWhitespace: "inlineFieldWhitespace";
    inlineFieldWikilinkOpenMarker: "inlineFieldWikilinkOpenMarker";
    inlineFieldWikilinkContent: "inlineFieldWikilinkContent";
    inlineFieldWikilinkCloseMarker: "inlineFieldWikilinkCloseMarker";
    inlineFieldTrailingSpace: "inlineFieldTrailingSpace";
    inlineFieldCloseParen: "inlineFieldCloseParen";
  }
}

// ---------- AST node types ----------

export interface WikilinkNode extends Node {
  type: "wikilink";
  target: string;
  alias: string | null;
}

export interface InlineFieldNode extends Node {
  type: "inlineField";
  key: string;
  target: string;
  alias: string | null;
}

// ---------- helpers ----------

function isAlpha(code: Code): boolean {
  return (
    code !== null &&
    ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
  );
}

function isAlphaOrConnector(code: Code): boolean {
  return isAlpha(code) || code === 95 /* _ */ || code === 45 /* - */;
}

// ---------- Wikilink micromark extension ----------
// Tokenizes: [[target]] or [[target|alias]]

function wikilinkTokenize(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State
): State {
  return start;

  function start(code: Code): State | undefined {
    if (code !== 91 /* [ */) return nok(code);
    effects.enter("wikilink");
    effects.enter("wikilinkOpenMarker");
    effects.consume(code);
    return openBracket2;
  }

  function openBracket2(code: Code): State | undefined {
    if (code !== 91 /* [ */) return nok(code);
    effects.consume(code);
    effects.exit("wikilinkOpenMarker");
    effects.enter("wikilinkContent");
    return content;
  }

  function content(code: Code): State | undefined {
    if (code === null || code < 0) return nok(code);
    if (code === 93 /* ] */) {
      effects.exit("wikilinkContent");
      effects.enter("wikilinkCloseMarker");
      effects.consume(code);
      return closeBracket2;
    }
    effects.consume(code);
    return content;
  }

  function closeBracket2(code: Code): State | undefined {
    if (code !== 93 /* ] */) return nok(code);
    effects.consume(code);
    effects.exit("wikilinkCloseMarker");
    effects.exit("wikilink");
    return ok;
  }
}

const wikilinkConstruct: Construct = {
  tokenize: wikilinkTokenize,
  name: "wikilink",
};

export const wikilinkSyntax: MicromarkExtension = {
  text: { 91: [wikilinkConstruct] },
};

export const wikilinkFromMarkdown: FromMarkdownExtension = {
  enter: {
    wikilink(token) {
      this.enter(
        { type: "wikilink", target: "", alias: null } as unknown as Parameters<typeof this.enter>[0],
        token
      );
    },
  },
  exit: {
    wikilinkContent(token) {
      const raw = this.sliceSerialize(token);
      const node = this.stack[this.stack.length - 1] as unknown as WikilinkNode;
      const pipe = raw.indexOf("|");
      if (pipe === -1) {
        node.target = raw.trim();
      } else {
        node.target = raw.slice(0, pipe).trim();
        node.alias = raw.slice(pipe + 1).trim();
      }
    },
    wikilink(token) {
      this.exit(token);
    },
  },
};

// ---------- Inline field micromark extension ----------
// Tokenizes: (Key:: [[target]]) or (Key:: [[target|alias]])
// Key must match [A-Za-z][A-Za-z_-]*

function inlineFieldTokenize(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State
): State {
  return start;

  function start(code: Code): State | undefined {
    if (code !== 40 /* ( */) return nok(code);
    effects.enter("inlineField");
    effects.enter("inlineFieldOpenParen");
    effects.consume(code);
    effects.exit("inlineFieldOpenParen");
    return keyStart;
  }

  function keyStart(code: Code): State | undefined {
    if (!isAlpha(code)) return nok(code);
    effects.enter("inlineFieldKey");
    effects.consume(code);
    return keyBody;
  }

  function keyBody(code: Code): State | undefined {
    if (isAlphaOrConnector(code)) {
      effects.consume(code);
      return keyBody;
    }
    if (code === 58 /* : */) {
      effects.exit("inlineFieldKey");
      effects.enter("inlineFieldSeparator");
      effects.consume(code);
      return separatorSecond;
    }
    return nok(code);
  }

  function separatorSecond(code: Code): State | undefined {
    if (code !== 58 /* : */) return nok(code);
    effects.consume(code);
    effects.exit("inlineFieldSeparator");
    return afterSeparator;
  }

  function afterSeparator(code: Code): State | undefined {
    if (code === 32 /* space */ || code === 9 /* tab */) {
      effects.enter("inlineFieldWhitespace");
      effects.consume(code);
      return whitespaceBeforeWikilink;
    }
    if (code === 91 /* [ */) {
      effects.enter("inlineFieldWikilinkOpenMarker");
      effects.consume(code);
      return wikilinkOpen2;
    }
    return nok(code);
  }

  function whitespaceBeforeWikilink(code: Code): State | undefined {
    if (code === 32 || code === 9) {
      effects.consume(code);
      return whitespaceBeforeWikilink;
    }
    effects.exit("inlineFieldWhitespace");
    if (code === 91) {
      effects.enter("inlineFieldWikilinkOpenMarker");
      effects.consume(code);
      return wikilinkOpen2;
    }
    return nok(code);
  }

  function wikilinkOpen2(code: Code): State | undefined {
    if (code !== 91 /* [ */) return nok(code);
    effects.consume(code);
    effects.exit("inlineFieldWikilinkOpenMarker");
    effects.enter("inlineFieldWikilinkContent");
    return wikilinkContent;
  }

  function wikilinkContent(code: Code): State | undefined {
    if (code === null || code < 0) return nok(code);
    if (code === 93 /* ] */) {
      effects.exit("inlineFieldWikilinkContent");
      effects.enter("inlineFieldWikilinkCloseMarker");
      effects.consume(code);
      return wikilinkClose2;
    }
    effects.consume(code);
    return wikilinkContent;
  }

  function wikilinkClose2(code: Code): State | undefined {
    if (code !== 93 /* ] */) return nok(code);
    effects.consume(code);
    effects.exit("inlineFieldWikilinkCloseMarker");
    return afterWikilink;
  }

  function afterWikilink(code: Code): State | undefined {
    if (code === 32 /* space */ || code === 9 /* tab */) {
      effects.enter("inlineFieldTrailingSpace");
      effects.consume(code);
      return trailingSpace;
    }
    if (code === 41 /* ) */) {
      effects.enter("inlineFieldCloseParen");
      effects.consume(code);
      effects.exit("inlineFieldCloseParen");
      effects.exit("inlineField");
      return ok;
    }
    return nok(code);
  }

  function trailingSpace(code: Code): State | undefined {
    if (code === 32 || code === 9) {
      effects.consume(code);
      return trailingSpace;
    }
    effects.exit("inlineFieldTrailingSpace");
    if (code === 41) {
      effects.enter("inlineFieldCloseParen");
      effects.consume(code);
      effects.exit("inlineFieldCloseParen");
      effects.exit("inlineField");
      return ok;
    }
    return nok(code);
  }
}

const inlineFieldConstruct: Construct = {
  tokenize: inlineFieldTokenize,
  name: "inlineField",
};

export const inlineFieldSyntax: MicromarkExtension = {
  text: { 40: [inlineFieldConstruct] },
};

export const inlineFieldFromMarkdown: FromMarkdownExtension = {
  enter: {
    inlineField(token) {
      this.enter(
        { type: "inlineField", key: "", target: "", alias: null } as unknown as Parameters<typeof this.enter>[0],
        token
      );
    },
  },
  exit: {
    inlineFieldKey(token) {
      const node = this.stack[this.stack.length - 1] as unknown as InlineFieldNode;
      node.key = this.sliceSerialize(token);
    },
    inlineFieldWikilinkContent(token) {
      const raw = this.sliceSerialize(token);
      const node = this.stack[this.stack.length - 1] as unknown as InlineFieldNode;
      const pipe = raw.indexOf("|");
      if (pipe === -1) {
        node.target = raw.trim();
      } else {
        node.target = raw.slice(0, pipe).trim();
        node.alias = raw.slice(pipe + 1).trim();
      }
    },
    inlineField(token) {
      this.exit(token);
    },
  },
};
