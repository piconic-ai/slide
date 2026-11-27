import { deck, Pad, slide } from "suraido.js";
import "suraido.js/deck.css";
import "suraido.js/themes/olivia.css";

// Five pages, each with a word of its own. They have no `path`, so the
// deck numbers them from 0.
const page = (title: string) =>
  slide(() => (
    <Pad>
      <h2>{title}</h2>
    </Pad>
  ));

deck([
  page("一ページ目 alpha"),
  page("二ページ目 bravo"),
  page("三ページ目 charlie"),
  page("四ページ目 delta"),
  page("五ページ目 echo"),
]);
