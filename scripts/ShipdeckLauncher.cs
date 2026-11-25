using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

/// <summary>
/// Starts the bundled Node runtime, waits until the API is up, and opens the UI.
/// Keep this exe beside the runtime\ and app\ folders.
/// </summary>
internal static class ShipdeckLauncher
{
    private static Process _server;

    private static int Main()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        string runtime = Path.Combine(baseDir, "runtime");
        string node = Path.Combine(runtime, "node.exe");
        string app = Path.Combine(baseDir, "app");
        string entry = Path.Combine(app, "apps", "api", "dist", "index.js");
        string apiPort = Environment.GetEnvironmentVariable("PORT");
        if (string.IsNullOrWhiteSpace(apiPort)) apiPort = "4000";
        string webPort = Environment.GetEnvironmentVariable("WEB_PORT");
        if (string.IsNullOrWhiteSpace(webPort)) webPort = "5173";

        Console.Title = "Shipdeck";
        if (!File.Exists(node) || !File.Exists(entry))
        {
            Console.WriteLine("Shipdeck is missing runtime\\node.exe or app\\apps\\api\\dist\\index.js.");
            Console.WriteLine("Unzip the whole folder, then run Shipdeck.exe from inside it.");
            Pause();
            return 1;
        }

        var psi = new ProcessStartInfo
        {
            FileName = node,
            Arguments = "\"" + entry + "\"",
            WorkingDirectory = app,
            UseShellExecute = false,
        };
        psi.EnvironmentVariables["PORT"] = apiPort;
        psi.EnvironmentVariables["WEB_PORT"] = webPort;
        string path = psi.EnvironmentVariables["PATH"] ?? "";
        psi.EnvironmentVariables["PATH"] = runtime + ";" + path;

        Console.WriteLine("Starting Shipdeck at http://localhost:" + webPort);
        Console.WriteLine("API: http://localhost:" + apiPort);
        Console.WriteLine("Close this window (or press Ctrl+C) to stop it.");
        Console.WriteLine();

        try
        {
            _server = Process.Start(psi);
        }
        catch (Exception ex)
        {
            Console.WriteLine("Could not start Node: " + ex.Message);
            Pause();
            return 1;
        }

        Console.CancelKeyPress += OnCancel;
        AppDomain.CurrentDomain.ProcessExit += delegate { StopServer(); };

        string health = "http://127.0.0.1:" + webPort + "/api/health";
        bool ready = false;
        for (int i = 0; i < 60 && _server != null && !_server.HasExited; i++)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(health);
                req.Timeout = 800;
                req.Method = "GET";
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    if ((int)res.StatusCode >= 200 && (int)res.StatusCode < 500)
                    {
                        ready = true;
                        break;
                    }
                }
            }
            catch
            {
                Thread.Sleep(250);
            }
        }

        if (_server != null && _server.HasExited)
        {
            Console.WriteLine("Shipdeck stopped before it was ready (exit " + _server.ExitCode + ").");
            Pause();
            return _server.ExitCode;
        }

        if (ready)
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://localhost:" + webPort) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                Console.WriteLine("Open this address in a browser: http://localhost:" + webPort);
                Console.WriteLine(ex.Message);
            }
        }
        else
        {
            Console.WriteLine("Still starting. If the browser does not open, go to http://localhost:" + webPort);
        }

        _server.WaitForExit();
        return _server.ExitCode;
    }

    private static void OnCancel(object sender, ConsoleCancelEventArgs e)
    {
        e.Cancel = true;
        StopServer();
    }

    private static void StopServer()
    {
        try
        {
            if (_server != null && !_server.HasExited) _server.Kill();
        }
        catch
        {
            /* already gone */
        }
    }

    private static void Pause()
    {
        Console.WriteLine("Press Enter to close.");
        Console.ReadLine();
    }
}
