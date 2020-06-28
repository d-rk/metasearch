import axios, { AxiosError, AxiosInstance } from "axios";

import { rateLimit } from "../util";

let getClient: (() => Promise<AxiosInstance>) | undefined;
let orgId: string | undefined;

const engine: Engine = {
  id: "figma",
  init: ({
    organization,
    password,
    user,
  }: {
    organization: number;
    password: string;
    user: string;
  }) => {
    getClient = rateLimit(async () => {
      // Log into Figma using their web browser flow. Their session token seems
      // to expire after 1-3 days in my testing.
      const tokenResponse = await axios.post(
        "https://www.figma.com/api/session/login",
        { email: user, password, username: user },
        { headers: { "Content-Type": "application/json" } },
      );
      const token = (tokenResponse.headers["set-cookie"] as string[])
        .find(c => /^figma\.st=[^;]/.test(c))
        ?.split(/[=;]/)[1];
      if (!token) {
        throw Error("Figma login failed");
      }

      return axios.create({
        baseURL: "https://www.figma.com",
        headers: { Cookie: `figma.st=${token}` },
      });
    }, 24);

    orgId = `${organization}`;
  },
  name: "Figma",
  search: async q => {
    interface Model<M> {
      getResult: (el: M, client: AxiosInstance) => Result | Promise<Result>;
      urlFragment: string;
    }

    interface File {
      creator: { handle: string };
      name: string;
      thumbnail_url: string;
      url: string;
    }

    /** Generates a string of HTML for displaying a linked thumbnail */
    const getThumbnail = async (client: AxiosInstance, f: File) => {
      try {
        await client.get(f.thumbnail_url, { maxRedirects: 0 });
        throw Error("Thumbnail URL not found");
      } catch (ex) {
        // TODO: Use library-provided type guard in v0.20
        // https://github.com/axios/axios/pull/2949
        if (
          ((e): e is AxiosError => e.isAxiosError)(ex) &&
          ex.response?.status === 302
        ) {
          const src = ex.response?.headers["location"] as string;
          return `<a href="${f.url}"><img src="${src}"></a>`;
        }
        throw ex;
      }
    };

    const MODEL_TYPES: Model<unknown>[] = [
      {
        getResult: async ({ model }: { model: File }, client) => ({
          snippet: `File created by ${
            model.creator.handle
          }<br>${await getThumbnail(client, model)}`,
          title: model.name,
          url: model.url,
        }),
        urlFragment: "fig_files",
      },
      {
        getResult: async (
          {
            file_count,
            model,
            recent_files,
          }: {
            file_count: number;
            model: { id: string; name: string };
            recent_files: File[];
          },
          client,
        ) => ({
          snippet: `Project containing ${
            file_count === 1 ? "1 file" : `${file_count} files`
          }<br>${(
            await Promise.all(
              recent_files.slice(0, 3).map(f => getThumbnail(client, f)),
            )
          ).join("")}`,
          title: model.name,
          url: `https://www.figma.com/files/${orgId}/project/${model.id}`,
        }),
        urlFragment: "folders",
      },
      {
        getResult: ({
          member_count,
          model,
        }: {
          member_count: number;
          model: { id: string; name: string };
        }) => ({
          snippet: `Team with ${
            member_count === 1 ? "1 member" : `${member_count} members`
          }`,
          title: model.name,
          url: `https://www.figma.com/files/${orgId}/team/${model.id}`,
        }),
        urlFragment: "teams",
      },
    ];

    return (
      await Promise.all(
        MODEL_TYPES.map(async ({ getResult, urlFragment }) => {
          if (!getClient) {
            throw Error("Engine not initialized");
          }

          const client = await getClient();
          const data: {
            meta: { results: Parameters<typeof getResult>[0][] };
          } = (
            await client.get(`/api/search/${urlFragment}`, {
              params: {
                desc: false,
                org_id: orgId,
                query: q,
                sort: "relevancy",
              },
            })
          ).data;
          return Promise.all(
            data.meta.results.map(el => getResult(el, client)),
          );
        }),
      )
    ).flat();
  },
};

export default engine;
