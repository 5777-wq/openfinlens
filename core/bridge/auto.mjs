/* auto.mjs —— 桥接自动安装入口：经典页面只需一个 <script type="module"> 标签。
 * 与 iife.mjs 的区别：本文件 import 即执行安装，无导出。
 * 浏览器模块作用域里 globalThis 就是 window（Node 下是 global）——一个表达式两端通吃。 */

import { installOn } from './iife.mjs';

installOn(globalThis);
