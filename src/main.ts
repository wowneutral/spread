import 'prosemirror-view/style/prosemirror.css';
import './styles.css';
import { boot, bootTimer } from './app';

// #timer opens the standalone pop-out timer window; anything else is the app.
if (location.hash === '#timer') bootTimer();
else boot();
