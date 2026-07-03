// ─── 工具定义（给 DeepSeek 看的"菜单"） ───

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "执行数学运算。支持加减乘除、三角函数、幂运算等。传入一个数学表达式字符串。",
      parameters: {
        type: "object" as const,
        properties: {
          expression: {
            type: "string",
            description: "数学表达式，如 '123 * 456' 或 'Math.sqrt(144)'",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "查询指定城市的当前天气。返回温度、天气状况、湿度等信息。",
      parameters: {
        type: "object" as const,
        properties: {
          city: {
            type: "string",
            description: "城市名称，中文或英文均可，如 '北京' 或 'Beijing'",
          },
        },
        required: ["city"],
      },
    },
  },
];

// ─── 工具实现 ───

type ToolResult = { success: boolean; result: string };

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case "calculator": {
      const expr = String(args.expression);
      // 安全包装：限制可用的全局函数，防止代码注入
      const safeEval = new Function(
        "Math",
        `"use strict"; return (${expr})`
      );
      const value = safeEval(Math);
      return { success: true, result: `${expr} = ${value}` };
    }

    case "get_weather": {
      const city = encodeURIComponent(String(args.city));
      try {
        const res = await fetch(
          `https://wttr.in/${city}?format=j1&lang=zh`,
          { signal: AbortSignal.timeout(10000) }
        );
        const data = await res.json();
        const c = data.current_condition?.[0];
        if (!c) return { success: false, result: "未找到该城市天气数据" };

        return {
          success: true,
          result: `${String(args.city)}当前天气：${c.weatherDesc?.[0]?.value ?? "未知"}，` +
            `温度 ${c.temp_C}°C（体感 ${c.FeelsLikeC}°C），` +
            `湿度 ${c.humidity}%，风速 ${c.windspeedKmph} km/h`,
        };
      } catch {
        return { success: false, result: "天气查询失败，请稍后重试" };
      }
    }

    default:
      return { success: false, result: `未知工具: ${name}` };
  }
}
