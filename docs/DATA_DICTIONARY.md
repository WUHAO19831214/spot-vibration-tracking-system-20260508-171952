# 数据字典

## 表格记录

| 界面字段 | 建议机器字段 | 类型 | 单位 | 来源/算法 | 备注 |
|---|---|---:|---|---|---|
| 序号 | `index` | integer | — | 首次出现频率递增 | 同频更新不新增序号 |
| 频率 | `frequency_hz` | number | Hz | Web Audio 当前设定值 | 不是独立实测频率 |
| 光斑振动幅度 | `spot_displacement_range_cm` | number | cm | `(y_max-y_min)×cm_per_pixel` | 峰—峰范围，不是机械振幅 A |
| 时间 | `elapsed_time_s` | number | s | `performance.now()` 相对页面初始化 | 不是摄像头硬件时间戳 |

## 帧级内部量

| 变量 | 单位 | 定义 |
|---|---|---|
| `x` | pixel | 红色候选像素加权重心横坐标 |
| `y` | pixel | 红色候选像素加权重心纵坐标 |
| `radius` | pixel | 红色候选范围的近似半径 |
| `t` | s | 页面初始化后的时间 |
| `weightSum` | arbitrary | 红色候选像素权重总和 |
| `recentPoints` | — | 最近约 8 s 的轨迹点 |
| `samplePoints` | — | 当前频率窗口的追踪点 |

## 扫频窗口

| 变量 | 单位 | 定义 |
|---|---|---|
| `frequency` | Hz | 当前窗口程序设定频率 |
| `yMin` | pixel | 窗口内最小纵坐标 |
| `yMax` | pixel | 窗口内最大纵坐标 |
| `hasPoint` | boolean | 是否至少锁定一次光斑 |
| `pixelDelta` | pixel | `yMax-yMin` |
| `deltaCm` | cm | `pixelDelta×cm_per_pixel` |

图像坐标 y 向下增加，但 `max(y)-min(y)` 始终为非负长度。

## 标定量

| 变量 | 单位 | 定义 |
|---|---|---|
| `calibrationStart/End` | overlay CSS pixel | 用户拖线端点 |
| `length` | video pixel | 映射回原始视频后的线段长度 |
| `cmPerPixel` | cm/pixel | `1/length` |

## 图表

```text
x = frequency_hz
y = spot_displacement_range_cm
```

散点按频率排序，以三次贝塞尔曲线视觉连接。连接曲线的中间位置不是新增测量值。

## 缺失与异常

- 未锁定光斑：窗口不生成记录；
- 未标定：当前实现按 0 换算，正式实验必须先标定；
- 重复频率：保留较大的范围值；
- 离群点：不自动标记或剔除；
- 刷新页面：内存数据丢失。
